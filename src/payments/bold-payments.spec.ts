import * as crypto from "node:crypto";
import { BadRequestException, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Model } from "mongoose";
import type { EnvironmentConfig } from "../config/config.interface";
import type { KvCacheService } from "../kv/kv-cache.service";
import type { SecurityAuditService } from "../common/audit/security-audit.service";
import type { TransactionDocument } from "./schemas/transaction.schema";
import { validateConfig } from "../config/config.validation";
import {
  BOLD_API_BASE_URL,
  buildBoldCheckoutConfig,
  canTransitionBoldStatus,
  extractBoldVoucherAmount,
  fetchBoldPaymentVoucher,
  generateBoldIntegritySignatureShared,
  isBoldVoucherMismatch,
  mapBoldWebhookStatus,
  normalizeBoldAmount,
  parseBoldWebhookJson,
  parseBoldWebhookPayload,
  redactBoldSecrets,
  sanitizeBoldDescription,
  verifyBoldWebhookSignatureShared,
} from "./bold.helpers";
import { applyBoldVoucherBody } from "./payments-sync.helpers";
import {
  getTransactionStatusHelper,
  handleWebhookHelper,
  type PaymentStatusDeps,
} from "./payments-status.helpers";
import { PaymentsService } from "./payments.service";

function makeConfigService(
  overrides: Record<string, string | undefined> = {},
): ConfigService<EnvironmentConfig> {
  const values: Record<string, string | undefined> = {
    BOLD_IDENTITY_KEY: "test_identity_key_123456",
    BOLD_PUBLIC_KEY: "test_public_key_123456",
    BOLD_SECRET_KEY: "test_secret_key_super_secret",
    BOLD_ENVIRONMENT: "production",
    NODE_ENV: "production",
    ...overrides,
  };
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService<EnvironmentConfig>;
}

function signBoldBody(rawBody: Buffer, secretKey: string): string {
  return crypto
    .createHmac("sha256", secretKey)
    .update(rawBody.toString("base64"))
    .digest("hex");
}

function makeKvMock() {
  const store = new Map<string, unknown>();
  return {
    store,
    kvCache: {
      get: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
      set: jest.fn((key: string, val: unknown) => {
        store.set(key, val);
        return Promise.resolve();
      }),
      delete: jest.fn((key: string) => {
        store.delete(key);
        return Promise.resolve();
      }),
    } as unknown as KvCacheService,
  };
}

function makeLoggerMock(): Logger {
  return {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;
}

describe("Bold Payment Gateway Protocol & Security", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe("Checkout Config, Integrity Signature & Input Sanitization", () => {
    it("generates exact SHA-256 integrity signature and uses unified payments.api.bold.co host even in sandbox", () => {
      const cfg = makeConfigService({ BOLD_ENVIRONMENT: "sandbox" });
      const result = buildBoldCheckoutConfig(
        cfg,
        "SHOP-abc12345-1761060600000-deadbeef",
        59900,
        "Compra Tienda BSK https://evil.example/phish   Casco Integral",
      );

      const expectedHash = crypto
        .createHash("sha256")
        .update(
          "SHOP-abc12345-1761060600000-deadbeef59900COPtest_secret_key_super_secret",
        )
        .digest("hex");

      expect(result.baseUrl).toBe(BOLD_API_BASE_URL);
      expect(result.apiKey).toBe("test_identity_key_123456");
      expect(result.publicKey).toBe("test_identity_key_123456");
      expect(result.amount).toBe(59900);
      expect(result.currency).toBe("COP");
      expect(result.integritySignature).toBe(expectedHash);
      expect(result.description).toBe("Compra Tienda BSK Casco Integral");
    });

    it("falls back to legacy BOLD_PUBLIC_KEY only when BOLD_IDENTITY_KEY is unset", () => {
      const cfg = makeConfigService({ BOLD_IDENTITY_KEY: "" });
      const result = buildBoldCheckoutConfig(
        cfg,
        "SHOP-fallback-1",
        10000,
        "Fallback Bold Key",
      );
      expect(result.apiKey).toBe("test_public_key_123456");
      expect(result.publicKey).toBe("test_public_key_123456");
    });

    it("rejects amounts below Bold 1000 COP minimum and invalid order IDs", () => {
      const cfg = makeConfigService();
      expect(() => normalizeBoldAmount(999)).toThrow(BadRequestException);
      expect(() =>
        generateBoldIntegritySignatureShared(cfg, "INVALID SPACE!", 10000),
      ).toThrow(BadRequestException);
      expect(() =>
        generateBoldIntegritySignatureShared(cfg, "A".repeat(61), 10000),
      ).toThrow(BadRequestException);
    });

    it("clamps descriptions to 100 chars and falls back when stripped to <2 chars", () => {
      expect(sanitizeBoldDescription("https://bskmt.com/test")).toBe(
        "Pago BSK Motorcycle Team",
      );
      expect(sanitizeBoldDescription("A".repeat(140)).length).toBe(100);
    });

    it("trims BOLD_* env keys and rejects internal whitespace/CRLF in config validation", () => {
      const base = {
        MONGODB_URI: "mongodb+srv://user:pass@cluster.example.net/db",
        BETTER_AUTH_SECRET: "a".repeat(32),
        CORS_ORIGIN: "https://dash.bskmt.com",
        CRON_SECRET: "b".repeat(20),
        BOLD_IDENTITY_KEY: "  id_key_clean  ",
        BOLD_SECRET_KEY: "  sec_key_clean  ",
        BOLD_PUBLIC_KEY: "  pub_key_clean  ",
      };
      const validated = validateConfig(base);
      expect(validated.BOLD_IDENTITY_KEY).toBe("id_key_clean");
      expect(validated.BOLD_SECRET_KEY).toBe("sec_key_clean");
      expect(validated.BOLD_PUBLIC_KEY).toBe("pub_key_clean");

      expect(() =>
        validateConfig({
          ...base,
          BOLD_IDENTITY_KEY: "bad_key\r\nX-Injected: 1",
        }),
      ).toThrow(/BOLD_IDENTITY_KEY/);
    });
  });

  describe("Webhook HMAC-SHA256 Verification & State Machine", () => {
    it("verifies valid lowercase and uppercase x-bold-signature headers", () => {
      const cfg = makeConfigService();
      const logger = makeLoggerMock();
      const rawBody = Buffer.from(
        JSON.stringify({ id: "evt-1", type: "SALE_APPROVED" }),
        "utf8",
      );
      const sig = signBoldBody(rawBody, "test_secret_key_super_secret");

      expect(() =>
        verifyBoldWebhookSignatureShared(cfg, logger, rawBody, sig),
      ).not.toThrow();
      expect(() =>
        verifyBoldWebhookSignatureShared(
          cfg,
          logger,
          rawBody,
          `  ${sig.toUpperCase()}  `,
        ),
      ).not.toThrow();
    });

    it("rejects invalid signatures, records audit event, and blocks empty-secret signatures in production", () => {
      const cfg = makeConfigService({
        BOLD_ENVIRONMENT: "production",
        NODE_ENV: "production",
      });
      const logger = makeLoggerMock();
      const recordEvent = jest.fn().mockResolvedValue(null);
      const auditService = { recordEvent } as unknown as SecurityAuditService;
      const rawBody = Buffer.from('{"id":"evt-2","type":"SALE_APPROVED"}');

      const emptySecretSig = signBoldBody(rawBody, "");
      expect(() =>
        verifyBoldWebhookSignatureShared(cfg, logger, rawBody, emptySecretSig, {
          auditService,
        }),
      ).toThrow(BadRequestException);
      expect(recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "BOLD_WEBHOOK_INVALID_SIGNATURE",
        }),
      );
    });

    it("accepts empty-secret Bold test webhook ONLY in non-production sandbox mode", () => {
      const cfg = makeConfigService({
        BOLD_ENVIRONMENT: "sandbox",
        NODE_ENV: "development",
      });
      const logger = makeLoggerMock();
      const rawBody = Buffer.from('{"id":"evt-test","type":"SALE_APPROVED"}');
      const emptySecretSig = signBoldBody(rawBody, "");

      expect(() =>
        verifyBoldWebhookSignatureShared(cfg, logger, rawBody, emptySecretSig),
      ).not.toThrow();
    });

    it("rejects malformed JSON and arrays with 400 BadRequestException", () => {
      expect(() => parseBoldWebhookJson(Buffer.from(""))).toThrow(
        BadRequestException,
      );
      expect(() => parseBoldWebhookJson(Buffer.from("{bad-json"))).toThrow(
        BadRequestException,
      );
      expect(() => parseBoldWebhookJson(Buffer.from("[]"))).toThrow(
        BadRequestException,
      );
    });

    it("maps VOID_REJECTED to null (audit-only) and allows APPROVED -> VOIDED transition only", () => {
      expect(mapBoldWebhookStatus("VOID_REJECTED")).toBeNull();
      expect(mapBoldWebhookStatus("VOID_APPROVED")).toBe("VOIDED");
      expect(mapBoldWebhookStatus("SALE_APPROVED")).toBe("APPROVED");
      expect(mapBoldWebhookStatus("SALE_REJECTED")).toBe("REJECTED");

      expect(canTransitionBoldStatus("PENDING", "APPROVED")).toBe(true);
      expect(canTransitionBoldStatus("PROCESSING", "APPROVED")).toBe(true);
      expect(canTransitionBoldStatus("APPROVED", "VOIDED")).toBe(true);
      expect(canTransitionBoldStatus("APPROVED", "REJECTED")).toBe(false);
      expect(canTransitionBoldStatus("APPROVED", "FAILED")).toBe(false);
      expect(canTransitionBoldStatus("REJECTED", "APPROVED")).toBe(false);
      expect(canTransitionBoldStatus("VOIDED", "APPROVED")).toBe(false);
      expect(canTransitionBoldStatus("FAILED", "APPROVED")).toBe(false);
    });
  });

  describe("Active Bold Voucher Sync (GET /v2/payment-voucher/{order_id})", () => {
    it("reads top-level total from official Bold voucher response and approves transaction", async () => {
      const cfg = makeConfigService();
      const logger = makeLoggerMock();
      const linkPaymentByPurpose = jest.fn().mockResolvedValue(undefined);
      const processAlegraInvoicing = jest.fn().mockResolvedValue(undefined);
      const { kvCache } = makeKvMock();

      const officialVoucherBody = {
        link_id: "BTN_8NSUASQINB",
        transaction_id: "CNPVI70CQC0EY",
        total: 59900,
        subtotal: 50336,
        description: "Compra Tienda BSK",
        reference_id: "SHOP-12345678-1761060600000-aabbccdd",
        payment_method: "CREDIT_CARD",
        payer_email: "pilot@bskmt.com",
        payment_status: "APPROVED",
      };

      expect(extractBoldVoucherAmount(officialVoucherBody)).toBe(59900);
      expect(
        isBoldVoucherMismatch(
          logger,
          "SHOP-12345678-1761060600000-aabbccdd",
          59900,
          officialVoucherBody,
        ),
      ).toBe(false);

      const tx = {
        _id: "tx-id-1",
        userId: "user-1",
        reference: "SHOP-12345678-1761060600000-aabbccdd",
        amount: 59900,
        status: "PROCESSING",
        benefitGranted: false,
        save: jest.fn().mockResolvedValue(undefined),
      } as unknown as TransactionDocument;

      const transactionModel = {
        updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      } as unknown as Model<TransactionDocument>;

      await applyBoldVoucherBody(
        {
          configService: cfg,
          transactionModel,
          logger,
          kvCache,
          linkPaymentByPurpose,
          processAlegraInvoicing,
        },
        tx,
        officialVoucherBody,
      );

      expect(tx.status).toBe("APPROVED");
      expect(tx.boldPaymentId).toBe("CNPVI70CQC0EY");
      expect(tx.paymentMethod).toBe("CREDIT_CARD");
      expect(linkPaymentByPurpose).toHaveBeenCalledWith(tx);
      expect(processAlegraInvoicing).toHaveBeenCalledWith(tx);
    });

    it("blocks voucher approval on amount, currency, or reference_id mismatch", () => {
      const logger = makeLoggerMock();
      expect(
        isBoldVoucherMismatch(logger, "ORD-1", 50000, {
          total: 49000,
          reference_id: "ORD-1",
        }),
      ).toBe(true);
      expect(
        isBoldVoucherMismatch(logger, "ORD-1", 50000, {
          total: 50000,
          currency: "USD",
          reference_id: "ORD-1",
        }),
      ).toBe(true);
      expect(
        isBoldVoucherMismatch(logger, "ORD-1", 50000, {
          total: 50000,
          reference_id: "ORD-DIFFERENT",
        }),
      ).toBe(true);
    });

    it("blocks 3xx redirects, enforces 1 MiB response cap, and redacts identity key in errors", async () => {
      const cfg = makeConfigService();
      const logger = makeLoggerMock();

      global.fetch = jest.fn().mockResolvedValue({
        status: 302,
        ok: false,
        headers: new Headers({ location: "https://attacker.example/steal" }),
      });

      const redirectRes = await fetchBoldPaymentVoucher(cfg, logger, "ORD-123");
      expect(redirectRes.ok).toBe(false);
      expect(redirectRes.reason).toBe("redirect_blocked");

      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        ok: true,
        headers: new Headers({ "content-length": String(2 * 1024 * 1024) }),
        text: jest.fn().mockResolvedValue("{}"),
      });

      const oversizeRes = await fetchBoldPaymentVoucher(cfg, logger, "ORD-123");
      expect(oversizeRes.ok).toBe(false);
      expect(oversizeRes.reason).toBe("response_too_large");

      global.fetch = jest
        .fn()
        .mockRejectedValue(
          new Error("Network error with x-api-key test_identity_key_123456"),
        );

      const errorRes = await fetchBoldPaymentVoucher(cfg, logger, "ORD-123");
      expect(errorRes.ok).toBe(false);
      expect(errorRes.reason).not.toContain("test_identity_key_123456");
      expect(
        redactBoldSecrets("Header x-api-key SECRET12345", ["SECRET12345"]),
      ).not.toContain("SECRET12345");
    });
  });

  describe("KV Cache Integrity, VOID_APPROVED Handling & Cross-Collection Delegation", () => {
    it("preserves full receipt fields in KV cache and invalidates KV on APPROVED -> VOIDED webhook", async () => {
      const cfg = makeConfigService();
      const logger = makeLoggerMock();
      const { kvCache, store } = makeKvMock();
      const recordEvent = jest.fn().mockResolvedValue(null);
      const auditService = { recordEvent } as unknown as SecurityAuditService;

      const txDoc = {
        _id: "tx-void-1",
        userId: "user-99",
        reference: "SHOP-user99-1761060600000-11223344",
        amount: 120000,
        description: "Chaqueta BSK Touring",
        tier: "shop",
        purpose: "shop",
        status: "APPROVED",
        boldPaymentId: "BOLD-PAY-1",
        paymentMethod: "PSE",
        createdAt: new Date("2026-11-20T10:00:00Z"),
        updatedAt: new Date("2026-11-20T10:01:00Z"),
        benefitGranted: true,
        webhookEvents: [],
        save: jest.fn().mockResolvedValue(undefined),
      } as unknown as TransactionDocument;

      const transactionModel = {
        findOne: jest.fn().mockResolvedValue(txDoc),
        updateOne: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
      } as unknown as Model<TransactionDocument>;

      const deps: PaymentStatusDeps = {
        transactionModel,
        configService: cfg,
        kvCache,
        logger,
        auditService,
        linkPaymentByPurpose: jest.fn().mockResolvedValue(undefined),
        processAlegraInvoicing: jest.fn().mockResolvedValue(undefined),
      };

      // 1st call populates KV with full receipt (never amount: 0)
      const first = await getTransactionStatusHelper(
        deps,
        "user-99",
        txDoc.reference,
      );
      expect(first.amount).toBe(120000);
      expect(first.description).toBe("Chaqueta BSK Touring");
      expect(store.has(`pay:status:user-99:${txDoc.reference}`)).toBe(true);

      // 2nd call hits KV and STILL returns real amount & description
      const second = await getTransactionStatusHelper(
        deps,
        "user-99",
        txDoc.reference,
      );
      expect(second.amount).toBe(120000);
      expect(second.description).toBe("Chaqueta BSK Touring");
      expect(second.purpose).toBe("shop");

      // VOID_APPROVED webhook transitions APPROVED -> VOIDED and invalidates KV
      const voidEvent = {
        id: "notif-void-1",
        type: "VOID_APPROVED",
        data: {
          payment_id: "BOLD-PAY-1",
          metadata: { reference: txDoc.reference },
          amount: { total: 120000, currency: "COP" },
        },
      };
      const rawBody = Buffer.from(JSON.stringify(voidEvent), "utf8");
      const sig = signBoldBody(rawBody, "test_secret_key_super_secret");

      await handleWebhookHelper(deps, rawBody, sig);

      expect(txDoc.status).toBe("VOIDED");
      expect(store.has(`pay:status:user-99:${txDoc.reference}`)).toBe(false);
      expect(recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "BOLD_APPROVED_PAYMENT_VOIDED",
        }),
      );
    });

    it("delegates membership webhooks and status queries when reference is not in transactions", async () => {
      const cfg = makeConfigService();
      const logger = makeLoggerMock();
      const { kvCache } = makeKvMock();
      const delegateMembershipWebhook = jest.fn().mockResolvedValue(true);
      const getMembershipPayment = jest.fn().mockResolvedValue({
        reference: "MEM-user99-1-1761060600000",
        purpose: "membership",
        status: "PENDING",
        amount: 3250000,
      });

      const transactionModel = {
        findOne: jest.fn().mockResolvedValue(null),
      } as unknown as Model<TransactionDocument>;

      const deps: PaymentStatusDeps = {
        transactionModel,
        configService: cfg,
        kvCache,
        logger,
        linkPaymentByPurpose: jest.fn().mockResolvedValue(undefined),
        processAlegraInvoicing: jest.fn().mockResolvedValue(undefined),
        delegateMembershipWebhook,
        getMembershipPayment,
      };

      const memEvent = {
        id: "notif-mem-1",
        type: "SALE_APPROVED",
        data: {
          payment_id: "BOLD-MEM-1",
          metadata: { reference: "MEM-user99-1-1761060600000" },
          amount: { total: 3250000, currency: "COP" },
        },
      };
      const rawBody = Buffer.from(JSON.stringify(memEvent), "utf8");
      const sig = signBoldBody(rawBody, "test_secret_key_super_secret");

      await handleWebhookHelper(deps, rawBody, sig);
      expect(delegateMembershipWebhook).toHaveBeenCalledWith(
        memEvent,
        parseBoldWebhookPayload(memEvent),
      );

      const statusRes = await getTransactionStatusHelper(
        deps,
        "user-99",
        "MEM-user99-1-1761060600000",
      );
      expect(getMembershipPayment).toHaveBeenCalledWith(
        "user-99",
        "MEM-user99-1-1761060600000",
      );
      expect(statusRes.purpose).toBe("membership");
    });

    it("returns failedIds only for transient errors in handleWebhookBatch", async () => {
      const cfg = makeConfigService();
      const { kvCache } = makeKvMock();
      const transactionModel = {
        findOne: jest
          .fn()
          .mockRejectedValueOnce(new Error("MongoServerSelectionError")),
      } as unknown as Model<TransactionDocument>;

      const service = new PaymentsService(
        transactionModel,
        cfg,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        kvCache,
        {} as never,
      );

      const validPayload = JSON.stringify({
        id: "evt-db-fail",
        type: "SALE_APPROVED",
        data: { metadata: { reference: "SHOP-db-fail" } },
      });
      const validSig = signBoldBody(
        Buffer.from(validPayload, "utf8"),
        "test_secret_key_super_secret",
      );

      const batchRes = await service.handleWebhookBatch([
        {
          id: "msg-transient-db-err",
          body: { rawBody: validPayload, signature: validSig },
        },
        {
          id: "msg-bad-sig-poison",
          body: { rawBody: validPayload, signature: "0".repeat(64) },
        },
      ]);

      expect(batchRes.processed).toBe(0);
      expect(batchRes.failed).toBe(2);
      expect(batchRes.failedIds).toEqual(["msg-transient-db-err"]);
    });
  });
});
