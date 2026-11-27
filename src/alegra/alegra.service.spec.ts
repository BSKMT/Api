import { Logger, UnauthorizedException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { Model } from "mongoose";
import type { EnvironmentConfig } from "../config/config.interface";
import type { KvCacheService } from "../kv/kv-cache.service";
import type { UsersService } from "../users/users.service";
import type { NotificationsService } from "../notifications/notifications.service";
import type { AlegraInvoiceDocument } from "./schemas/alegra-invoice.schema";
import {
  isAllowedAlegraPdfUrl,
  isValidAlegraId,
  mapPaymentMethod,
  sanitizeAlegraErrorForUser,
} from "./alegra.constants";
import {
  getAlegraBaseUrl,
  isAlegraConfigured,
  makeAlegraDetailedRequest,
} from "./alegra-http.client";
import {
  buildContactData,
  findContactByEmail,
  tryCreateContact,
} from "./alegra-contact.helpers";
import {
  buildInvoiceItems,
  buildInvoicePayload,
  discoverDefaultItemId,
  discoverElectronicNumberTemplateId,
  isInvalidUnspscProductKey,
} from "./alegra-invoice.helpers";
import {
  classifyAlegraCreateInvoiceError,
  executeCreateInvoiceDetailed,
  executeEmailInvoice,
  executeGetInvoicePdfDetails,
} from "./alegra-api.helpers";
import {
  claimInvoiceProcessingLock,
  executeRetryFailedInvoice,
  executeRetryFailedInvoiceDetailed,
  saveApprovedInvoice,
} from "./alegra-payment.helpers";
import { queryInvoicePdfUrlByTransaction } from "./alegra-query.helpers";
import { processInvoiceWebhookEvent } from "./alegra-webhook.helpers";
import { AlegraController } from "./alegra.controller";
import { AlegraService } from "./alegra.service";

function createConfigMock(
  values: Partial<Record<keyof EnvironmentConfig, unknown>>,
): ConfigService<EnvironmentConfig> {
  return {
    get: jest.fn((key: keyof EnvironmentConfig) => values[key]),
  } as unknown as ConfigService<EnvironmentConfig>;
}

function createKvMock(): KvCacheService {
  const store = new Map<string, unknown>();
  return {
    get: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    set: jest.fn((key: string, val: unknown) => {
      store.set(key, val);
      return Promise.resolve();
    }),
    delete: jest.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
  } as unknown as KvCacheService;
}

describe("Alegra integration security, DIAN 2.1 compliance and resilience", () => {
  const logger = new Logger("AlegraSpec");

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  describe("DIAN 2.1 payment methods & validators", () => {
    it("maps Colombian payment methods to valid DIAN 2.1 enums (never invalid TRANSFER)", () => {
      expect(mapPaymentMethod("NEQUI")).toEqual({
        invoice: "DEBIT_TRANSFER",
        payment: "transfer",
      });
      expect(mapPaymentMethod("DAVIPLATA")).toEqual({
        invoice: "DEBIT_TRANSFER",
        payment: "transfer",
      });
      expect(mapPaymentMethod("BOTON_BANCOLOMBIA")).toEqual({
        invoice: "DEBIT_TRANSFER",
        payment: "transfer",
      });
      expect(mapPaymentMethod("PSE")).toEqual({
        invoice: "DEBIT_TRANSFER",
        payment: "transfer",
      });
      expect(mapPaymentMethod("DEPOSIT")).toEqual({
        invoice: "BANK_DEPOSIT",
        payment: "deposit",
      });
      expect(mapPaymentMethod("CREDIT_CARD")).toEqual({
        invoice: "CREDIT_CARD",
        payment: "credit-card",
      });
    });

    it("enforces strict HTTPS Alegra PDF host allowlist and valid IDs", () => {
      expect(
        isAllowedAlegraPdfUrl(
          "https://cdn3.alegra.com/invoices/pdf/sample-FEV23.pdf?Expires=123",
        ),
      ).toBe(true);
      expect(isAllowedAlegraPdfUrl("http://cdn3.alegra.com/test.pdf")).toBe(
        false,
      );
      expect(
        isAllowedAlegraPdfUrl("https://cdn3.alegra.com.evil.com/test.pdf"),
      ).toBe(false);
      expect(
        isAllowedAlegraPdfUrl("https://user:pass@cdn3.alegra.com/test.pdf"),
      ).toBe(false);

      expect(isValidAlegraId("29")).toBe(true);
      expect(isValidAlegraId("0")).toBe(false);
      expect(isValidAlegraId("../invoices")).toBe(false);
    });

    it("sanitizes internal Alegra errors before returning them to end users", () => {
      expect(
        sanitizeAlegraErrorForUser("ALEGRA_ITEM_ID missing in env"),
      ).not.toContain("ALEGRA_ITEM_ID");
      expect(
        sanitizeAlegraErrorForUser("Failed to create/find contact"),
      ).toContain("datos fiscales");
      expect(
        classifyAlegraCreateInvoiceError(
          402,
          JSON.stringify({
            code: 900,
            message: "Has llegado al límite de facturas en tu plan actual.",
          }),
        ),
      ).toBe("ALEGRA_HTTP_402_PLAN_LIMIT");
      const safeQuotaMsg = sanitizeAlegraErrorForUser(
        "ALEGRA_HTTP_402_PLAN_LIMIT",
      );
      expect(safeQuotaMsg).toContain("temporalmente pausada");
      expect(safeQuotaMsg).not.toContain("402");
      expect(safeQuotaMsg).not.toContain("plan");
      expect(
        classifyAlegraCreateInvoiceError(
          400,
          JSON.stringify({
            message:
              "no cumple con las validaciones necesarias: El campo código del producto/servicio seleccionado es inválido.",
          }),
        ),
      ).toBe("ALEGRA_HTTP_400_INVALID_PRODUCT_KEY");
      const safeProductKeyMsg = sanitizeAlegraErrorForUser(
        "ALEGRA_HTTP_400_INVALID_PRODUCT_KEY",
      );
      expect(safeProductKeyMsg).toContain("catálogo fiscal");
      expect(safeProductKeyMsg).not.toContain("400");
      expect(safeProductKeyMsg).not.toContain("productKey");
      expect(sanitizeAlegraErrorForUser(null)).toBeNull();
    });

    it("detects invalid UNSPSC class-level productKey codes ending in 00", () => {
      expect(isInvalidUnspscProductKey(null)).toBe(false);
      expect(isInvalidUnspscProductKey(undefined)).toBe(false);
      expect(isInvalidUnspscProductKey("")).toBe(false);
      expect(isInvalidUnspscProductKey("53102902")).toBe(false);
      expect(isInvalidUnspscProductKey("94121510")).toBe(false);
      expect(isInvalidUnspscProductKey("94121500")).toBe(true);
      expect(isInvalidUnspscProductKey("941215")).toBe(true);
      expect(isInvalidUnspscProductKey("INVALID")).toBe(true);
    });
  });

  describe("HTTP client SSRF & redirect protection", () => {
    it("reads boolean ALEGRA_ENABLED from ConfigService and locks production base URL", () => {
      const cfg = createConfigMock({
        ALEGRA_ENABLED: true,
        ALEGRA_EMAIL: "billing@bskmt.com",
        ALEGRA_TOKEN: "secret-token",
        ALEGRA_API_URL: "https://evil.example.com/api/v1",
        NODE_ENV: "production",
      });
      expect(isAlegraConfigured(cfg)).toBe(true);
      expect(getAlegraBaseUrl(cfg)).toBe("https://api.alegra.com/api/v1");
    });

    it("blocks 3xx redirects on outbound Alegra requests", async () => {
      const cfg = createConfigMock({
        ALEGRA_ENABLED: true,
        ALEGRA_EMAIL: "billing@bskmt.com",
        ALEGRA_TOKEN: "secret-token",
        ALEGRA_API_URL: "https://api.alegra.com/api/v1",
        ALEGRA_TIMEOUT_MS: 10000,
      });

      const fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://attacker.example/steal" },
        }),
      );

      const redirectRes = await makeAlegraDetailedRequest(
        cfg,
        logger,
        "POST",
        "/invoices",
        { test: true },
      );
      expect(redirectRes.ok).toBe(false);
      expect(redirectRes.status).toBe(302);
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://api.alegra.com/api/v1/invoices",
        expect.objectContaining({ redirect: "manual" }),
      );
    });
  });

  describe("Contact builder & discovery", () => {
    it("builds DIAN 2.1 contact with nameObject, mobile from celular, department, and NIT dv", () => {
      const person = buildContactData({
        email: "rider@bskmt.com",
        profile: {
          "datos-personales": {
            primerNombre: "Laura",
            segundoNombre: "Sofia",
            primerApellido: "Gomez",
            segundoApellido: "Diaz",
            tipoDocumento: "CC",
            numeroDocumento: "1012345678",
          },
          contacto: {
            celular: "3101234567",
            departamento: "Cundinamarca",
            ciudad: "Bogotá, D.C.",
            direccion: "Calle 100 # 10-20",
          },
        },
      });
      expect(person.nameObject).toEqual({
        firstName: "Laura",
        secondName: "Sofia",
        lastName: "Gomez",
        secondLastName: "Diaz",
      });
      expect(person.mobile).toBe("3101234567");
      expect(person.address).toEqual({
        address: "Calle 100 # 10-20",
        department: "Cundinamarca",
        city: "Bogotá, D.C.",
        country: "Colombia",
      });
      expect(person.settings).toEqual({ sendElectronicDocuments: true });

      const company = buildContactData({
        email: "facturacion@empresa.co",
        identityVerification: {
          fullName: "Motear SAS",
          documentType: "NIT",
          documentNumber: "901444877-6",
        },
      });
      expect(company.kindOfPerson).toBe("LEGAL_ENTITY");
      expect(company.identificationObject).toEqual({
        type: "NIT",
        number: "901444877",
        dv: "6",
      });
    });

    it("ignores inactive contacts when searching by email and reuses contactId on 400 code 2006", async () => {
      const makeRequest = jest.fn(() =>
        Promise.resolve([
          {
            id: "1",
            email: "rider@bskmt.com",
            status: "inactive",
            type: ["client"],
          },
          {
            id: "8",
            email: "rider@bskmt.com",
            status: "active",
            type: ["client"],
          },
        ]),
      );
      const found = await findContactByEmail(
        makeRequest as never,
        "rider@bskmt.com",
      );
      expect(found?.id).toBe("8");

      const makeDetailed = jest.fn(() =>
        Promise.resolve({
          ok: false,
          status: 400,
          data: null,
          errorText: JSON.stringify({ code: 2006, contactId: "42" }),
        }),
      );
      const reused = await tryCreateContact(
        makeDetailed as never,
        { name: "Test", type: ["client"] },
        logger,
      );
      expect(reused).toBe("42");
    });
  });

  describe("Dynamic item, electronic template & total reconciliation", () => {
    it("skips inactive catalog items and picks active electronic non-expired numberTemplate", async () => {
      const cfg = createConfigMock({});
      const kv = createKvMock();
      const makeRequest = jest.fn((_m: string, path: string) => {
        if (path.startsWith("/items?query=")) {
          return Promise.resolve([
            { id: "23", name: "Inactive", status: "inactive" },
          ]);
        }
        if (path.startsWith("/items?limit=30")) {
          return Promise.resolve([
            { id: "23", name: "Old", status: "inactive" },
            {
              id: "77",
              name: "Ingreso BSKMT",
              reference: "BSKMT-GENERIC",
              status: "active",
            },
          ]);
        }
        if (path === "/number-templates") {
          return Promise.resolve([
            {
              id: "12",
              documentType: "invoice",
              isElectronic: true,
              status: "active",
              isDefault: false,
              endDate: "2022-01-01",
            },
            {
              id: "19",
              documentType: "invoice",
              isElectronic: true,
              status: "active",
              isDefault: true,
              prefix: "FEV",
              endDate: "2099-12-31",
            },
          ]);
        }
        return Promise.resolve(null);
      });

      const itemId = await discoverDefaultItemId(
        cfg,
        kv,
        makeRequest as never,
        logger,
      );
      expect(itemId).toBe("77");

      const templateId = await discoverElectronicNumberTemplateId(
        cfg,
        kv,
        makeRequest as never,
        logger,
      );
      expect(templateId).toBe("19");
    });

    it("falls back to consolidated line when shop items sum differs from paid amount", () => {
      const items = buildInvoiceItems(
        {
          userId: "u1",
          transactionReference: "SHOP-1234",
          purpose: "shop",
          amount: 85_000,
          description: "Compra Tienda BSK - ORD-1",
          items: [
            {
              name: "Chaqueta",
              reference: "chaqueta-bsk",
              price: 100_000,
              quantity: 1,
            },
          ],
        },
        "77",
      );
      expect(items).toHaveLength(1);
      expect(items[0].price).toBe(85_000);
      expect(items[0].reference).toBe("BSKMT-SHOP");

      const payload = buildInvoicePayload(
        {
          userId: "u1",
          transactionReference: "SHOP-1234",
          purpose: "shop",
          amount: 85_000,
          description: "Compra Tienda BSK",
          paymentMethod: "NEQUI",
        },
        "8",
        "77",
        "5",
        "19",
      );
      expect(payload.paymentMethod).toBe("DEBIT_TRANSFER");
      expect(payload.numberTemplate).toEqual({ id: "19" });
    });

    it("skips catalog item with invalid UNSPSC class productKey and evicts cache on 400 invalid productKey", async () => {
      const cfg = createConfigMock({});
      const kv = createKvMock();
      const makeRequest = jest.fn((_m: string, path: string) => {
        if (path.startsWith("/items?query=")) {
          return Promise.resolve([
            {
              id: "77",
              name: "Ingreso BSKMT",
              reference: "BSKMT-GENERIC",
              status: "active",
              productKey: "94121500",
            },
            {
              id: "48",
              name: "Gorra For All BSKMT",
              reference: "gorra-bsk",
              status: "active",
              productKey: "53102902",
            },
          ]);
        }
        return Promise.resolve(null);
      });

      const chosenId = await discoverDefaultItemId(
        cfg,
        kv,
        makeRequest as never,
        logger,
      );
      expect(chosenId).toBe("48");

      const detailedCfg = createConfigMock({
        ALEGRA_ITEM_ID: "77",
        ALEGRA_SELLER_ID: "5",
        ALEGRA_NUMBER_TEMPLATE_ID: "19",
      });
      await kv.set("alegra:default_item_id", "77", 86400, true);
      const makeDetailed = jest.fn(() =>
        Promise.resolve({
          ok: false,
          status: 400,
          data: null,
          errorText: JSON.stringify({
            message:
              "El campo código del producto/servicio seleccionado es inválido.",
          }),
        }),
      );
      const detailed = await executeCreateInvoiceDetailed(
        jest.fn(() => Promise.resolve(null)) as never,
        makeDetailed as never,
        detailedCfg,
        kv,
        {
          userId: "u1",
          transactionReference: "SHOP-BAD-KEY",
          purpose: "shop",
          amount: 1200,
          description: "Compra Test",
          paymentMethod: "NEQUI",
        },
        "26",
        logger,
      );
      expect(detailed).toEqual({
        data: null,
        errorCode: "ALEGRA_HTTP_400_INVALID_PRODUCT_KEY",
      });
      expect(await kv.get("alegra:default_item_id", true)).toBeNull();
    });
  });

  describe("Email dispatch, PDF reconciliation & atomic idempotency", () => {
    it("sends required { emails: [email] } payload to POST /invoices/{id}/email", async () => {
      const makeRequest = jest.fn(() => Promise.resolve({ message: "sent" }));
      const sent = await executeEmailInvoice(
        makeRequest as never,
        "29",
        "pilot@bskmt.com",
        logger,
      );
      expect(sent).toBe(true);
      expect(makeRequest).toHaveBeenCalledWith("POST", "/invoices/29/email", {
        emails: ["pilot@bskmt.com"],
      });

      const skipped = await executeEmailInvoice(
        makeRequest as never,
        "29",
        "",
        logger,
      );
      expect(skipped).toBe(false);
    });

    it("rejects untrusted PDF hosts and reconciles missing CUFE on read-through", async () => {
      const badReq = jest.fn(() =>
        Promise.resolve({
          id: "29",
          pdf: "https://evil.example/fake.pdf",
        }),
      );
      expect(
        await executeGetInvoicePdfDetails(badReq as never, "29", logger),
      ).toBeNull();

      const updateOne = jest.fn(() => Promise.resolve({ modifiedCount: 1 }));
      const invoiceModel = {
        findOne: jest.fn(() =>
          Promise.resolve({
            _id: "doc1",
            alegraInvoiceId: "28",
            alegraInvoiceNumber: null,
            cufe: null,
            stamped: false,
            stampStatus: "PENDING",
            status: "PAID",
          }),
        ),
        updateOne,
      } as unknown as Model<AlegraInvoiceDocument>;

      const pdfUrl = await queryInvoicePdfUrlByTransaction(
        invoiceModel,
        () =>
          Promise.resolve({
            pdfUrl: "https://cdn3.alegra.com/invoices/pdf/FEV22.pdf",
            invoiceNumber: "FEV22",
            cufe: "abc123cufe",
            stampStatus: "STAMPED_AND_ACCEPTED",
            status: "closed",
            balance: 0,
          }),
        "u1",
        "MEMC-EVT-1234",
        "event",
      );
      expect(pdfUrl).toBe("https://cdn3.alegra.com/invoices/pdf/FEV22.pdf");
      expect(updateOne).toHaveBeenCalledTimes(1);
      const reconcileArgs = updateOne.mock.calls[0] as unknown[];
      expect(reconcileArgs[0]).toEqual({ _id: "doc1" });
      const reconcileSet = (
        reconcileArgs[1] as { $set: Record<string, unknown> }
      ).$set;
      expect(reconcileSet.alegraInvoiceNumber).toBe("FEV22");
      expect(reconcileSet.cufe).toBe("abc123cufe");
      expect(reconcileSet.stamped).toBe(true);
      expect(reconcileSet.stampStatus).toBe("STAMPED_AND_ACCEPTED");
      expect(reconcileSet.stampedAt).toBeInstanceOf(Date);
    });

    it("prevents concurrent duplicate invoicing via atomic claim lock and preserves honest stamp status", async () => {
      const findOneAndUpdateMock = jest.fn(() => Promise.resolve(null));
      const findOneMock = jest.fn(() => Promise.resolve(null));
      const createMock = jest
        .fn()
        .mockResolvedValueOnce({ _id: "1" })
        .mockRejectedValueOnce({ code: 11000 });
      const invoiceModel = {
        findOneAndUpdate: findOneAndUpdateMock,
        findOne: findOneMock,
        create: createMock,
      } as unknown as Model<AlegraInvoiceDocument>;

      const ctx = {
        userId: "u1",
        transactionReference: "SHOP-RACE-0001",
        purpose: "shop",
        amount: 50_000,
        description: "Test",
      };

      expect(await claimInvoiceProcessingLock(invoiceModel, ctx, logger)).toBe(
        true,
      );
      expect(await claimInvoiceProcessingLock(invoiceModel, ctx, logger)).toBe(
        false,
      );

      const notif = {
        create: jest.fn(() => Promise.resolve(null)),
      } as unknown as NotificationsService;
      await saveApprovedInvoice(invoiceModel, notif, logger, {
        context: ctx,
        invoiceData: {
          invoiceId: "30",
          invoiceNumber: null,
          cufe: null,
          stampStatus: null,
        },
        contactId: "8",
        paymentId: null,
        emailed: false,
      });

      const lastCall = findOneAndUpdateMock.mock.calls.at(-1) as unknown[];
      expect(lastCall[0]).toEqual({
        transactionReference: "SHOP-RACE-0001",
        purpose: "shop",
      });
      expect((lastCall[1] as { $set: Record<string, unknown> }).$set).toEqual(
        expect.objectContaining({
          stamped: false,
          stampStatus: "PENDING",
          status: "CREATED",
        }),
      );
    });

    it("preserves paymentMethod and itemsSnapshot during retryFailedInvoice and skips zero-amount payments", async () => {
      const processPaymentFn = jest.fn(() => Promise.resolve());
      const findOneMock = jest.fn(() =>
        Promise.resolve({
          userId: "u1",
          transactionReference: "SHOP-RETRY-001",
          purpose: "shop",
          status: "FAILED",
          alegraInvoiceId: "0",
          amount: 120_000,
          description: "Pedido Retry",
          paymentMethod: "NEQUI",
          itemsSnapshot: [{ name: "Guantes", price: 120_000, quantity: 1 }],
        }),
      );
      const invoiceModel = {
        findOne: findOneMock,
      } as unknown as Model<AlegraInvoiceDocument>;

      const ok = await executeRetryFailedInvoice(
        invoiceModel,
        processPaymentFn,
        "SHOP-RETRY-001",
        "shop",
        logger,
      );
      expect(ok).toBe(true);
      expect(processPaymentFn).toHaveBeenCalledWith(
        expect.objectContaining({
          paymentMethod: "NEQUI",
          items: [{ name: "Guantes", price: 120_000, quantity: 1 }],
        }),
      );

      const service = new AlegraService(
        invoiceModel,
        createConfigMock({
          ALEGRA_ENABLED: true,
          ALEGRA_EMAIL: "billing@bskmt.com",
          ALEGRA_TOKEN: "token",
        }),
        {} as UsersService,
        {} as NotificationsService,
        createKvMock(),
      );
      findOneMock.mockClear();
      await service.processApprovedPayment({
        userId: "u1",
        transactionReference: "FREE-0001",
        purpose: "event",
        amount: 0,
        description: "Rodada Gratuita",
      });
      expect(findOneMock).not.toHaveBeenCalled();

      const detailedFindOne = jest
        .fn()
        .mockResolvedValueOnce({
          userId: "u1",
          transactionReference: "SHOP-QUOTA-402",
          purpose: "shop",
          status: "FAILED",
          alegraInvoiceId: "0",
          amount: 1200,
          description: "Pedido Cuota",
        })
        .mockResolvedValueOnce({
          userId: "u1",
          transactionReference: "SHOP-QUOTA-402",
          purpose: "shop",
          status: "FAILED",
          alegraInvoiceId: "0",
          errorMessage: "ALEGRA_HTTP_402_PLAN_LIMIT",
        });
      const detailedOutcome = await executeRetryFailedInvoiceDetailed(
        { findOne: detailedFindOne } as unknown as Model<AlegraInvoiceDocument>,
        jest.fn(() => Promise.resolve()),
        "SHOP-QUOTA-402",
        "shop",
        logger,
      );
      expect(detailedOutcome).toEqual({
        status: "failed",
        errorMessage: "ALEGRA_HTTP_402_PLAN_LIMIT",
      });
    });
  });

  describe("Webhook authentication & reconciliation", () => {
    it("enforces constant-time header authentication and handles void/rejection events", async () => {
      const alegraService = {
        handleWebhook: jest.fn(() => Promise.resolve()),
      } as unknown as AlegraService;
      const controller = new AlegraController(
        alegraService,
        createConfigMock({ ALEGRA_WEBHOOK_SECRET: "super-secret-token" }),
      );

      await expect(
        controller.handleWebhook({ subject: "edit-invoice" }, "wrong"),
      ).rejects.toThrow(UnauthorizedException);

      await expect(
        controller.handleWebhook(
          { subject: "edit-invoice" },
          undefined,
          "Bearer super-secret-token",
        ),
      ).resolves.toEqual({ received: true });

      const save = jest.fn(() => Promise.resolve());
      const record = {
        transactionReference: "SHOP-9999",
        alegraInvoiceId: "29",
        status: "PAID",
        stamped: true,
        stampStatus: "STAMPED_AND_ACCEPTED",
        save,
      };
      const invoiceModel = {
        findOne: jest.fn(() => Promise.resolve(record)),
      } as unknown as Model<AlegraInvoiceDocument>;

      await processInvoiceWebhookEvent(
        invoiceModel,
        {
          subject: "edit-invoice",
          message: { invoice: { id: "29", status: "void" } },
        },
        "edit-invoice",
        logger,
      );
      expect(record.status).toBe("CANCELLED");
      expect(save).toHaveBeenCalled();
    });
  });
});
