import { Logger, UnauthorizedException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { EnvironmentConfig } from "../config/config.interface";
import type { KvCacheService } from "../kv/kv-cache.service";
import type { NotificationsService } from "../notifications/notifications.service";
import {
  buildContactData,
  mapDocumentTypeToAlegra,
} from "./alegra-contact.helpers";
import {
  discoverDefaultItemId,
  discoverDefaultBankAccountId,
  discoverDefaultSellerId,
  buildInvoicePayload,
  buildPaymentPayload,
  buildInvoiceItems,
} from "./alegra-invoice.helpers";
import {
  mapPaymentMethod,
  ALEGRA_DEFAULT_FALLBACK_ITEM_ID,
  ALEGRA_DEFAULT_FALLBACK_BANK_ACCOUNT_ID,
  ALEGRA_DEFAULT_FALLBACK_SELLER_ID,
} from "./alegra.constants";
import { makeAlegraRequest } from "./alegra-http.client";
import {
  executeApprovedPaymentFlow,
  executeRetryFailedInvoice,
} from "./alegra-payment.helpers";
import { processInvoiceWebhookEvent } from "./alegra-webhook.helpers";
import { queryInvoicePdfUrlByTransaction } from "./alegra-query.helpers";
import { AlegraController } from "./alegra.controller";
import type {
  AlegraBillingContext,
  CreatedInvoiceData,
  AlegraWebhookPayload,
} from "./alegra.interfaces";

describe("Alegra Integration Module", () => {
  const dummyLogger = new Logger("AlegraTest");

  describe("mapDocumentTypeToAlegra & buildContactData", () => {
    it("should map CC, CE, TI, etc. to PERSON_ENTITY and NIT to LEGAL_ENTITY", () => {
      expect(mapDocumentTypeToAlegra("CC")).toEqual({
        type: "CC",
        kindOfPerson: "PERSON_ENTITY",
      });
      expect(mapDocumentTypeToAlegra("NIT")).toEqual({
        type: "NIT",
        kindOfPerson: "LEGAL_ENTITY",
      });
      expect(mapDocumentTypeToAlegra("ce")).toEqual({
        type: "CE",
        kindOfPerson: "PERSON_ENTITY",
      });
      expect(mapDocumentTypeToAlegra(undefined)).toEqual({
        type: "CC",
        kindOfPerson: "PERSON_ENTITY",
      });
    });

    it("should build contact with full identity verification", () => {
      const user = {
        email: "test@bskmt.com",
        phone: "+573001234567",
        identityVerification: {
          fullName: "Juan Perez Gomez",
          documentType: "CC",
          documentNumber: "1020304050",
        },
      };

      const contact = buildContactData(user);
      expect(contact.name).toBe("Juan Perez Gomez");
      expect(contact.email).toBe("test@bskmt.com");
      expect(contact.identification).toBe("1020304050");
      expect(contact.identificationObject).toEqual({
        type: "CC",
        number: "1020304050",
        dv: null,
      });
      expect(contact.kindOfPerson).toBe("PERSON_ENTITY");
      expect(contact.regime).toBe("SIMPLIFIED_REGIME");
      expect(contact.phonePrimary).toBe("+573001234567");
    });

    it("should fall back to user.email if names in profile are empty strings", () => {
      const user = {
        email: "rider@bskmt.com",
        identityVerification: null,
        profile: {
          "datos-personales": {
            primerNombre: "  ",
            primerApellido: "",
            tipoDocumento: "CC",
            numeroDocumento: "987654321",
          },
          contacto: {
            telefono: "3100000000",
            ciudad: "Medellín",
            direccion: "Calle 10 # 20-30",
          },
        },
      };

      const contact = buildContactData(user);
      expect(contact.name).toBe("rider@bskmt.com");
      expect(contact.identification).toBe("987654321");
      expect(contact.address?.city).toBe("Medellín");
      expect(contact.address?.address).toBe("Calle 10 # 20-30");
    });

    it("should handle NIT company profile as LEGAL_ENTITY", () => {
      const user = {
        email: "empresa@bskmt.com",
        identityVerification: null,
        profile: {
          "datos-personales": {
            primerNombre: "Taller BSK Motos SAS",
            tipoDocumento: "NIT",
            numeroDocumento: "901444877",
          },
        },
      };

      const contact = buildContactData(user);
      expect(contact.name).toBe("Taller BSK Motos SAS");
      expect(contact.kindOfPerson).toBe("LEGAL_ENTITY");
      expect(contact.identificationObject?.type).toBe("NIT");
    });
  });

  describe("Payment Method Mapping & Payload Builders", () => {
    it("should map various gateways to valid Alegra methods", () => {
      expect(mapPaymentMethod("CARD")).toEqual({
        invoice: "CREDIT_CARD",
        payment: "credit-card",
      });
      expect(mapPaymentMethod("credit_card")).toEqual({
        invoice: "CREDIT_CARD",
        payment: "credit-card",
      });
      expect(mapPaymentMethod("PSE")).toEqual({
        invoice: "DEBIT_CARD",
        payment: "debit-card",
      });
      expect(mapPaymentMethod("nequi")).toEqual({
        invoice: "TRANSFER",
        payment: "transfer",
      });
      expect(mapPaymentMethod("cash")).toEqual({
        invoice: "CASH",
        payment: "cash",
      });
      expect(mapPaymentMethod(null)).toEqual({
        invoice: "CASH",
        payment: "cash",
      });
    });

    it("should build invoice items with custom items and generic fallback", () => {
      const contextCustom: AlegraBillingContext = {
        userId: "u1",
        transactionReference: "REF-1",
        purpose: "shop",
        amount: 50000,
        description: "Tienda BSK",
        items: [
          {
            name: "Gorra BSK",
            price: 25000,
            quantity: 2,
            reference: "CAP-01",
          },
        ],
      };
      const items = buildInvoiceItems(contextCustom, "77");
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe("77");
      expect(items[0].name).toBe("Gorra BSK");
      expect(items[0].quantity).toBe(2);

      const contextGeneric: AlegraBillingContext = {
        userId: "u2",
        transactionReference: "REF-2",
        purpose: "membership",
        amount: 150000,
        description: "Membresía BSK Anual",
      };
      const genericItems = buildInvoiceItems(contextGeneric, "77");
      expect(genericItems).toHaveLength(1);
      expect(genericItems[0].name).toBe("Membresía BSK Anual");
      expect(genericItems[0].price).toBe(150000);
    });

    it("should build full invoice payload and payment payload", () => {
      const context: AlegraBillingContext = {
        userId: "u1",
        transactionReference: "SHOP-12345",
        purpose: "shop",
        amount: 120000,
        description: "Compra Tienda",
        paymentMethod: "CARD",
      };

      const invPayload = buildInvoicePayload(context, "c-8", "77", "5");
      expect(invPayload.client).toBe("c-8");
      expect(invPayload.seller).toBe("5");
      expect(invPayload.paymentMethod).toBe("CREDIT_CARD");
      expect(invPayload.stamp?.generateStamp).toBe(true);

      const payPayload = buildPaymentPayload(
        "inv-29",
        120000,
        "7",
        context.paymentMethod,
      );
      expect(payPayload.bankAccount).toBe("7");
      expect(payPayload.paymentMethod).toBe("credit-card");
      expect(payPayload.invoices[0].id).toBe("inv-29");
    });
  });

  describe("Auto-discovery Helpers", () => {
    let mockKvCache: Partial<KvCacheService>;
    let mockConfigService: Partial<ConfigService<EnvironmentConfig>>;

    beforeEach(() => {
      mockKvCache = {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue(true),
      };
      mockConfigService = {
        get: jest.fn().mockReturnValue(undefined),
      };
    });

    it("should discover default item ID matching Ingreso BSKMT", async () => {
      const mockRequest = jest.fn().mockResolvedValue([
        { id: "77", name: "Ingreso BSKMT", reference: "BSKMT-GENERIC" },
        { id: "23", name: "ACEITE MOTOR" },
      ]);

      const itemId = await discoverDefaultItemId(
        mockConfigService as ConfigService<EnvironmentConfig>,
        mockKvCache as KvCacheService,
        mockRequest,
        dummyLogger,
      );

      expect(itemId).toBe("77");
      expect(mockKvCache.set).toHaveBeenCalledWith(
        expect.stringContaining("default_item_id"),
        "77",
        86400,
        true,
      );
    });

    it("should discover default bank account matching BOLD", async () => {
      const mockRequest = jest.fn().mockResolvedValue([
        { id: "1", name: "Caja general", status: "active" },
        { id: "7", name: "BOLD. C.F.", status: "active" },
      ]);

      const bankId = await discoverDefaultBankAccountId(
        mockConfigService as ConfigService<EnvironmentConfig>,
        mockKvCache as KvCacheService,
        mockRequest,
        dummyLogger,
      );

      expect(bankId).toBe("7");
      expect(mockKvCache.set).toHaveBeenCalledWith(
        expect.stringContaining("default_bank_account_id"),
        "7",
        86400,
        true,
      );
    });

    it("should discover default seller matching Ventas En Linea BSKMT", async () => {
      const mockRequest = jest.fn().mockResolvedValue([
        { id: "1", name: "Vendedor Local", status: "active" },
        { id: "5", name: "Ventas En Linea BSKMT", status: "active" },
      ]);

      const sellerId = await discoverDefaultSellerId(
        mockConfigService as ConfigService<EnvironmentConfig>,
        mockKvCache as KvCacheService,
        mockRequest,
        dummyLogger,
      );

      expect(sellerId).toBe("5");
      expect(mockKvCache.set).toHaveBeenCalledWith(
        expect.stringContaining("default_seller_id"),
        "5",
        86400,
        true,
      );
    });

    it("should return fallback constants if auto-discovery fails", async () => {
      const failingRequest = jest.fn().mockRejectedValue(new Error("Net down"));

      const itemId = await discoverDefaultItemId(
        mockConfigService as ConfigService<EnvironmentConfig>,
        mockKvCache as KvCacheService,
        failingRequest,
        dummyLogger,
      );
      expect(itemId).toBe(ALEGRA_DEFAULT_FALLBACK_ITEM_ID);

      const bankId = await discoverDefaultBankAccountId(
        mockConfigService as ConfigService<EnvironmentConfig>,
        mockKvCache as KvCacheService,
        failingRequest,
        dummyLogger,
      );
      expect(bankId).toBe(ALEGRA_DEFAULT_FALLBACK_BANK_ACCOUNT_ID);

      const sellerId = await discoverDefaultSellerId(
        mockConfigService as ConfigService<EnvironmentConfig>,
        mockKvCache as KvCacheService,
        failingRequest,
        dummyLogger,
      );
      expect(sellerId).toBe(ALEGRA_DEFAULT_FALLBACK_SELLER_ID);
    });
  });

  describe("makeAlegraRequest HTTP Client", () => {
    const originalFetch = globalThis.fetch;
    const originalEnv = process.env.ALEGRA_ENABLED;

    beforeAll(() => {
      process.env.ALEGRA_ENABLED = "true";
    });

    afterAll(() => {
      globalThis.fetch = originalFetch;
      process.env.ALEGRA_ENABLED = originalEnv;
    });

    it("should return parsed JSON on HTTP 200", async () => {
      const mockConfig: Partial<ConfigService<EnvironmentConfig>> = {
        get: jest.fn((key: string) => {
          if (key === "ALEGRA_EMAIL") return "cespedesandres684@gmail.com";
          if (key === "ALEGRA_TOKEN") return "secret_token_123";
          return undefined;
        }) as any,
      };

      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ id: "29", status: "open" })),
      });

      const res = await makeAlegraRequest<{ id: string }>(
        mockConfig as ConfigService<EnvironmentConfig>,
        dummyLogger,
        "GET",
        "/invoices/29",
      );

      expect(res).toEqual({ id: "29", status: "open" });
    });

    it("should return empty object on HTTP 204 No Content without failing", async () => {
      const mockConfig: Partial<ConfigService<EnvironmentConfig>> = {
        get: jest.fn((key: string) => {
          if (key === "ALEGRA_EMAIL") return "cespedesandres684@gmail.com";
          if (key === "ALEGRA_TOKEN") return "secret_token_123";
          return undefined;
        }) as any,
      };

      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 204,
        text: () => Promise.resolve(""),
      });

      const res = await makeAlegraRequest<unknown>(
        mockConfig as ConfigService<EnvironmentConfig>,
        dummyLogger,
        "POST",
        "/invoices/29/email",
      );

      expect(res).toEqual({});
    });

    it("should handle 429 Rate Limit backoff returning null", async () => {
      const mockConfig: Partial<ConfigService<EnvironmentConfig>> = {
        get: jest.fn((key: string) => {
          if (key === "ALEGRA_EMAIL") return "cespedesandres684@gmail.com";
          if (key === "ALEGRA_TOKEN") return "secret_token_123";
          return undefined;
        }) as any,
      };

      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: () => Promise.resolve("Too Many Requests"),
      });

      const res = await makeAlegraRequest<unknown>(
        mockConfig as ConfigService<EnvironmentConfig>,
        dummyLogger,
        "GET",
        "/invoices",
      );

      expect(res).toBeNull();
    });
  });

  describe("executeApprovedPaymentFlow & Error Recording", () => {
    let mockInvoiceModel: any;
    let mockNotificationsService: Partial<NotificationsService>;

    beforeEach(() => {
      mockInvoiceModel = {
        findOneAndUpdate: jest.fn().mockResolvedValue({}),
        findOne: jest.fn().mockResolvedValue(null),
      };
      mockNotificationsService = {
        create: jest.fn().mockResolvedValue({} as any),
      };
    });

    it("should complete flow: contact -> invoice -> payment -> email -> save", async () => {
      const context: AlegraBillingContext = {
        userId: "user_abc",
        transactionReference: "TX_100",
        purpose: "membership",
        amount: 80000,
        description: "Membresía BSK",
        paymentMethod: "PSE",
      };

      const ops = {
        ensureContactFn: jest.fn().mockResolvedValue("contact_8"),
        createInvoiceFn: jest.fn().mockResolvedValue({
          invoiceId: "inv_99",
          invoiceNumber: "FEV24",
          cufe: "cufe_test_123",
          stampStatus: "STAMPED_AND_ACCEPTED",
        }),
        createPaymentFn: jest.fn().mockResolvedValue("pay_55"),
        emailInvoiceFn: jest.fn().mockResolvedValue(true),
      };

      await executeApprovedPaymentFlow(
        context,
        ops,
        mockInvoiceModel,
        mockNotificationsService as NotificationsService,
        dummyLogger,
      );

      expect(ops.ensureContactFn).toHaveBeenCalledWith("user_abc");
      expect(ops.createInvoiceFn).toHaveBeenCalledWith(context, "contact_8");
      expect(ops.createPaymentFn).toHaveBeenCalledWith(
        "inv_99",
        80000,
        "PSE",
      );
      expect(ops.emailInvoiceFn).toHaveBeenCalledWith("inv_99");

      expect(mockInvoiceModel.findOneAndUpdate).toHaveBeenCalledWith(
        { transactionReference: "TX_100", purpose: "membership" },
        expect.objectContaining({
          $set: expect.objectContaining({
            alegraInvoiceId: "inv_99",
            alegraPaymentId: "pay_55",
            status: "PAID",
            cufe: "cufe_test_123",
          }),
        }),
        { upsert: true, new: true },
      );

      expect(mockNotificationsService.create).toHaveBeenCalled();
    });

    it("should record failed invoice when contact creation fails", async () => {
      const context: AlegraBillingContext = {
        userId: "user_xyz",
        transactionReference: "TX_ERR",
        purpose: "event",
        amount: 30000,
        description: "Evento BSK",
      };

      const ops = {
        ensureContactFn: jest.fn().mockResolvedValue(null),
        createInvoiceFn: jest.fn(),
        createPaymentFn: jest.fn(),
        emailInvoiceFn: jest.fn(),
      };

      await executeApprovedPaymentFlow(
        context,
        ops,
        mockInvoiceModel,
        mockNotificationsService as NotificationsService,
        dummyLogger,
      );

      expect(ops.createInvoiceFn).not.toHaveBeenCalled();
      expect(mockInvoiceModel.findOneAndUpdate).toHaveBeenCalledWith(
        { transactionReference: "TX_ERR", purpose: "event" },
        expect.objectContaining({
          $set: expect.objectContaining({
            status: "FAILED",
            alegraInvoiceId: "0",
          }),
        }),
        { upsert: true },
      );
    });
  });

  describe("Webhook Processing & DIAN Stamp Reconciliation", () => {
    it("should update CUFE, stampStatus, and fullNumber from webhook message", async () => {
      const mockRecord: any = {
        alegraInvoiceId: "29",
        transactionReference: "TX_STAMP",
        cufe: null,
        stamped: false,
        stampStatus: "PENDING",
        alegraInvoiceNumber: null,
        status: "STAMPED",
        save: jest.fn().mockResolvedValue(true),
      };

      const mockModel = {
        findOne: jest.fn().mockResolvedValue(mockRecord),
      };

      const payload: AlegraWebhookPayload = {
        subject: "invoice.edit",
        message: {
          invoice: {
            id: "29",
            balance: 0,
            numberTemplate: { fullNumber: "FEV23" },
            stamp: {
              legalStatus: "STAMPED_AND_ACCEPTED",
              cufe: "029364274c4c8be2fba2397b790ba9e88bc16cb00ab77a2daa479b87eaa38eb0db196050c731cce2419990b33ba0d04a",
            },
          },
        },
      };

      await processInvoiceWebhookEvent(
        mockModel as any,
        payload,
        payload.subject,
        dummyLogger,
      );

      expect(mockRecord.cufe).toBe(payload.message.invoice!.stamp!.cufe);
      expect(mockRecord.stamped).toBe(true);
      expect(mockRecord.stampStatus).toBe("STAMPED_AND_ACCEPTED");
      expect(mockRecord.alegraInvoiceNumber).toBe("FEV23");
      expect(mockRecord.status).toBe("PAID");
      expect(mockRecord.save).toHaveBeenCalled();
    });
  });

  describe("AlegraController Security Guardrails", () => {
    let controller: AlegraController;
    let mockService: Partial<any>;
    let mockConfig: Partial<ConfigService<EnvironmentConfig>>;

    beforeEach(() => {
      mockService = {
        handleWebhook: jest.fn().mockResolvedValue(undefined),
      };
      mockConfig = {
        get: jest.fn((key: string) => {
          if (key === "ALEGRA_WEBHOOK_SECRET") return "super-secure-token-123";
          return undefined;
        }) as any,
      };
      controller = new AlegraController(
        mockService as any,
        mockConfig as ConfigService<EnvironmentConfig>,
      );
    });

    it("should reject webhook request when secret token does not match", async () => {
      await expect(
        controller.handleWebhook({}, "wrong-token"),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("should reject webhook request when ALEGRA_WEBHOOK_SECRET is not configured", async () => {
      mockConfig.get = jest.fn().mockReturnValue(undefined) as any;
      await expect(
        controller.handleWebhook({}, "super-secure-token-123"),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("should accept valid webhook request with timing-safe comparison", async () => {
      const res = await controller.handleWebhook(
        { subject: "invoice.new", message: {} },
        "super-secure-token-123",
      );
      expect(res).toEqual({ received: true });
      expect(mockService.handleWebhook).toHaveBeenCalled();
    });
  });
});
