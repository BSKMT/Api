import * as crypto from "node:crypto";
import { BadRequestException, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { EnvironmentConfig } from "../config/config.interface";
import {
  AuditSeverity,
  SecurityAuditService,
} from "../common/audit/security-audit.service";
import { maskReference } from "../common/utils/log-redact.util";

/**
 * Single official Bold Payments API origin for both production and sandbox
 * (Bold distinguishes environments solely by production vs. test API keys).
 */
export const BOLD_API_BASE_URL = "https://payments.api.bold.co";

export const BOLD_ALLOWED_HOSTS = new Set<string>([
  "payments.api.bold.co",
  "integrations.api.bold.co",
]);

export const BOLD_MIN_AMOUNT_COP = 1_000;
export const BOLD_MAX_DESCRIPTION_LENGTH = 100;
export const BOLD_FETCH_TIMEOUT_MS = 10_000;
export const MAX_BOLD_RESPONSE_BYTES = 1_048_576; // 1 MiB
export const BOLD_ORDER_ID_REGEX = /^[A-Za-z0-9_-]{1,60}$/;
export const BOLD_HEX_SIGNATURE_REGEX = /^[0-9a-f]{64}$/;

const URL_STRIP_REGEX = /(?:https?:\/\/|www\.)\S+/gi;
const WHITESPACE_COLLAPSE_REGEX = /\s+/g;

export interface ParsedBoldWebhookPayload {
  notificationId?: string;
  eventType?: string;
  paymentId?: string;
  referenceId?: string;
  paymentMethod?: string;
  payerEmail?: string;
  amount?: number;
  currency?: string;
}

export interface BoldCheckoutConfig {
  apiKey: string;
  publicKey: string;
  environment: string;
  baseUrl: string;
  referenceId: string;
  description: string;
  amount: number;
  currency: "COP";
  integritySignature: string;
}

export interface BoldVoucherFetchResult {
  ok: boolean;
  status?: number;
  body?: Record<string, unknown>;
  reason?: string;
}

export function resolveBoldEnvironment(
  configService: ConfigService<EnvironmentConfig>,
): string {
  return (
    configService
      .get<string>("BOLD_ENVIRONMENT", { infer: true })
      ?.trim()
      .toLowerCase() || "sandbox"
  );
}

export function resolveBoldIdentityKey(
  configService: ConfigService<EnvironmentConfig>,
): string {
  const identity = configService
    .get<string>("BOLD_IDENTITY_KEY", { infer: true })
    ?.trim();
  if (identity) return identity;
  return (
    configService.get<string>("BOLD_PUBLIC_KEY", { infer: true })?.trim() ?? ""
  );
}

export function resolveBoldPublicKey(
  configService: ConfigService<EnvironmentConfig>,
): string {
  const identity = configService
    .get<string>("BOLD_IDENTITY_KEY", { infer: true })
    ?.trim();
  if (identity) return identity;
  return (
    configService.get<string>("BOLD_PUBLIC_KEY", { infer: true })?.trim() ?? ""
  );
}

export function resolveBoldSecretKey(
  configService: ConfigService<EnvironmentConfig>,
): string {
  return (
    configService.get<string>("BOLD_SECRET_KEY", { infer: true })?.trim() ?? ""
  );
}

/**
 * Sanitizes payment descriptions according to official Bold Checkout rules:
 * - 2 to 100 characters
 * - Must NOT contain URLs
 */
export function sanitizeBoldDescription(raw: string | undefined): string {
  const cleaned = (raw ?? "")
    .replaceAll(URL_STRIP_REGEX, "")
    .replaceAll(WHITESPACE_COLLAPSE_REGEX, " ")
    .trim()
    .slice(0, BOLD_MAX_DESCRIPTION_LENGTH)
    .trim();

  if (cleaned.length < 2) {
    return "Pago BSK Motorcycle Team";
  }
  return cleaned;
}

/**
 * Validates and rounds Bold COP checkout amounts to safe integers >= 1000 COP.
 */
export function normalizeBoldAmount(amount: number): number {
  if (!Number.isFinite(amount)) {
    throw new BadRequestException("Monto de pago inválido");
  }
  const rounded = Math.round(amount);
  if (rounded < BOLD_MIN_AMOUNT_COP) {
    throw new BadRequestException(
      `El monto mínimo para pagos con Bold es $${BOLD_MIN_AMOUNT_COP.toLocaleString("es-CO")} COP`,
    );
  }
  return rounded;
}

/**
 * Enforces Bold order-id rules: 1..60 characters matching [A-Za-z0-9_-].
 */
export function assertValidBoldOrderId(orderId: string): string {
  const trimmed = orderId.trim();
  if (!BOLD_ORDER_ID_REGEX.test(trimmed)) {
    throw new BadRequestException("Referencia de orden Bold inválida");
  }
  return trimmed;
}

export function redactBoldSecrets(message: string, secrets: string[]): string {
  let sanitized = message;
  for (const secret of secrets) {
    const trimmed = secret.trim();
    if (trimmed.length >= 6) {
      sanitized = sanitized.split(trimmed).join("[REDACTED]");
    }
  }
  return sanitized.replaceAll(/x-api-key\s+\S+/gi, "x-api-key [REDACTED]");
}

/**
 * Generates Bold Checkout SHA-256 integrity signature:
 * SHA256(orderId + amount + currency + secretKey)
 */
export function generateBoldIntegritySignatureShared(
  configService: ConfigService<EnvironmentConfig>,
  orderId: string,
  amount: number,
  currency = "COP",
): string {
  const secretKey = resolveBoldSecretKey(configService);
  if (!secretKey) {
    throw new BadRequestException("BOLD_SECRET_KEY not configured");
  }
  const safeOrderId = assertValidBoldOrderId(orderId);
  const safeAmount = normalizeBoldAmount(amount);
  const safeCurrency = currency.trim().toUpperCase();
  const concatenated = `${safeOrderId}${safeAmount}${safeCurrency}${secretKey}`;
  return crypto.createHash("sha256").update(concatenated).digest("hex");
}

export function buildBoldCheckoutConfig(
  configService: ConfigService<EnvironmentConfig>,
  reference: string,
  amount: number,
  description: string,
): BoldCheckoutConfig {
  const safeReference = assertValidBoldOrderId(reference);
  const safeAmount = normalizeBoldAmount(amount);
  const safeDescription = sanitizeBoldDescription(description);
  const boldPublicKey = resolveBoldPublicKey(configService);
  const boldEnvironment = resolveBoldEnvironment(configService);

  return {
    apiKey: boldPublicKey,
    publicKey: boldPublicKey,
    environment: boldEnvironment,
    baseUrl: BOLD_API_BASE_URL,
    referenceId: safeReference,
    description: safeDescription,
    amount: safeAmount,
    currency: "COP",
    integritySignature: generateBoldIntegritySignatureShared(
      configService,
      safeReference,
      safeAmount,
      "COP",
    ),
  };
}

export function parseBoldAmount(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (typeof obj["total"] === "number" && Number.isFinite(obj["total"])) {
      return obj["total"];
    }
    if (typeof obj["amount"] === "number" && Number.isFinite(obj["amount"])) {
      return obj["amount"];
    }
  }
  return undefined;
}

export function parseBoldCurrency(raw: unknown): string | undefined {
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (typeof obj["currency"] === "string" && obj["currency"].trim()) {
      return obj["currency"].trim().toUpperCase();
    }
  }
  return undefined;
}

export function parseBoldWebhookJson(rawBody: Buffer): Record<string, unknown> {
  if (rawBody.byteLength === 0) {
    throw new BadRequestException("Empty webhook payload");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody.toString("utf-8"));
  } catch {
    throw new BadRequestException("Invalid webhook JSON payload");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new BadRequestException("Webhook payload must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

export function parseBoldWebhookPayload(
  event: Record<string, unknown>,
): ParsedBoldWebhookPayload {
  const data = (event["data"] ?? {}) as Record<string, unknown>;
  const metadata = (data["metadata"] ?? {}) as Record<string, unknown>;
  return {
    notificationId: typeof event["id"] === "string" ? event["id"] : undefined,
    eventType: typeof event["type"] === "string" ? event["type"] : undefined,
    paymentId:
      typeof data["payment_id"] === "string" ? data["payment_id"] : undefined,
    referenceId:
      typeof metadata["reference"] === "string"
        ? metadata["reference"].trim()
        : undefined,
    paymentMethod:
      typeof data["payment_method"] === "string"
        ? data["payment_method"]
        : undefined,
    payerEmail:
      typeof data["payer_email"] === "string" ? data["payer_email"] : undefined,
    amount: parseBoldAmount(data["amount"]),
    currency: parseBoldCurrency(data["amount"]),
  };
}

/**
 * Maps Bold webhook event types to internal transaction statuses.
 * Note: VOID_REJECTED means an attempted void on an approved sale was rejected;
 * the original transaction status MUST remain unchanged (audit-only).
 */
export function mapBoldWebhookStatus(
  eventType: string | undefined,
): string | null {
  switch (eventType) {
    case "SALE_APPROVED":
    case "PAYMENT_APPROVED":
      return "APPROVED";
    case "SALE_REJECTED":
    case "PAYMENT_REJECTED":
      return "REJECTED";
    case "VOID_APPROVED":
    case "PAYMENT_VOIDED":
      return "VOIDED";
    case "PAYMENT_FAILED":
      return "FAILED";
    case "PAYMENT_PROCESSING":
      return "PROCESSING";
    case "VOID_REJECTED":
    default:
      return null;
  }
}

export function mapBoldVoucherStatusShared(boldStatus: string): string | null {
  switch (boldStatus.trim().toUpperCase()) {
    case "APPROVED":
      return "APPROVED";
    case "REJECTED":
      return "REJECTED";
    case "FAILED":
      return "FAILED";
    case "VOIDED":
      return "VOIDED";
    case "PROCESSING":
      return "PROCESSING";
    case "PENDING":
    default:
      return null;
  }
}

/**
 * Explicit Bold transaction state machine:
 * - PENDING / PROCESSING -> PROCESSING | APPROVED | REJECTED | FAILED | VOIDED
 * - APPROVED -> VOIDED ONLY (supports Bold VOID_APPROVED reversals)
 * - REJECTED / FAILED / VOIDED -> strictly immutable
 */
export function canTransitionBoldStatus(
  currentStatus: string,
  nextStatus: string,
): boolean {
  if (currentStatus === nextStatus) {
    return false;
  }
  if (currentStatus === "PENDING" || currentStatus === "PROCESSING") {
    return true;
  }
  if (currentStatus === "APPROVED") {
    return nextStatus === "VOIDED";
  }
  return false;
}

function timingSafeHexSignatureMatches(
  bodyBase64: string,
  normalizedSignatureHex: string,
  secretKey: string,
): boolean {
  const expectedHex = crypto
    .createHmac("sha256", secretKey)
    .update(bodyBase64)
    .digest("hex");
  const providedBuf = Buffer.from(normalizedSignatureHex, "hex");
  const expectedBuf = Buffer.from(expectedHex, "hex");
  return (
    providedBuf.length === expectedBuf.length &&
    crypto.timingSafeEqual(providedBuf, expectedBuf)
  );
}

function recordInvalidWebhookAudit(
  auditService: SecurityAuditService | undefined,
  path: string,
  reason: string,
): void {
  if (!auditService) return;
  auditService
    .recordEvent({
      requestId: crypto.randomUUID(),
      eventType: "BOLD_WEBHOOK_INVALID_SIGNATURE",
      severity: AuditSeverity.WARN,
      clientIp: "webhook",
      method: "POST",
      path,
      statusCode: 400,
      details: { reason },
    })
    .catch(() => {});
}

export function recordBoldVoidedAudit(
  auditService: SecurityAuditService | undefined,
  path: string,
  reference: string,
  amount: number,
  source: "webhook" | "voucher_sync",
): void {
  if (!auditService) return;
  auditService
    .recordEvent({
      requestId: crypto.randomUUID(),
      eventType: "BOLD_APPROVED_PAYMENT_VOIDED",
      severity: AuditSeverity.ERROR,
      clientIp: source,
      method: "POST",
      path,
      statusCode: 200,
      details: {
        reference: maskReference(reference),
        amount,
        source,
      },
    })
    .catch(() => {});
}

/**
 * Verifies Bold `x-bold-signature` header using HMAC-SHA256(base64(rawBody), secretKey).
 * Production strictly requires a non-empty BOLD_SECRET_KEY.
 * Non-production sandbox mode supports Bold's documented empty-secret test webhook button.
 */
export function verifyBoldWebhookSignatureShared(
  configService: ConfigService<EnvironmentConfig>,
  logger: Logger,
  rawBody: Buffer,
  signature: string,
  options?: { auditService?: SecurityAuditService; path?: string },
): void {
  const secretKey = resolveBoldSecretKey(configService);
  const path = options?.path ?? "/api/payments/webhook";

  if (!secretKey) {
    logger.error("BOLD_SECRET_KEY not configured — rejecting webhook");
    recordInvalidWebhookAudit(
      options?.auditService,
      path,
      "missing_secret_key",
    );
    throw new BadRequestException("Webhook secret key not configured");
  }

  const normalizedSig = signature.trim().toLowerCase();
  if (!BOLD_HEX_SIGNATURE_REGEX.test(normalizedSig)) {
    logger.warn("Malformed Bold webhook signature format received");
    recordInvalidWebhookAudit(
      options?.auditService,
      path,
      "malformed_signature_hex",
    );
    throw new BadRequestException("Invalid signature");
  }

  const bodyBase64 = rawBody.toString("base64");
  const matchesConfigured = timingSafeHexSignatureMatches(
    bodyBase64,
    normalizedSig,
    secretKey,
  );
  if (matchesConfigured) {
    return;
  }

  const boldEnv = resolveBoldEnvironment(configService);
  const nodeEnv =
    configService.get<string>("NODE_ENV", { infer: true }) ??
    process.env.NODE_ENV ??
    "development";

  if (
    boldEnv !== "production" &&
    nodeEnv !== "production" &&
    timingSafeHexSignatureMatches(bodyBase64, normalizedSig, "")
  ) {
    logger.log("Accepted Bold sandbox test webhook signed with empty secret");
    return;
  }

  logger.warn("Invalid Bold webhook signature received");
  recordInvalidWebhookAudit(options?.auditService, path, "hmac_mismatch");
  throw new BadRequestException("Invalid signature");
}

/**
 * Extracts total amount from Bold GET /v2/payment-voucher/{order_id} response.
 * Official Bold voucher API returns top-level `total`, while legacy mocks may
 * nest it under `amount.total`.
 */
export function extractBoldVoucherAmount(
  body: Record<string, unknown>,
): number | undefined {
  return parseBoldAmount(body["amount"] ?? body);
}

export function isBoldAmountOrCurrencyMismatch(
  logger: Logger,
  reference: string,
  expectedAmount: number,
  receivedAmount: number | undefined,
  receivedCurrency: string | undefined,
  sourceLabel: string,
): boolean {
  if (receivedCurrency && receivedCurrency !== "COP") {
    logger.warn(
      `Currency mismatch in ${sourceLabel} for ref ${maskReference(reference)}: expected COP, received ${receivedCurrency}. Skipping approval.`,
    );
    return true;
  }
  if (expectedAmount <= 0) return false;
  if (receivedAmount === undefined) {
    logger.warn(
      `Missing or invalid amount in ${sourceLabel} for ref ${maskReference(reference)}: expected ${expectedAmount}. Skipping approval.`,
    );
    return true;
  }
  if (receivedAmount !== expectedAmount) {
    logger.warn(
      `Amount mismatch in ${sourceLabel} for ref ${maskReference(reference)}: expected ${expectedAmount}, received ${receivedAmount}. Skipping approval.`,
    );
    return true;
  }
  return false;
}

export function isBoldVoucherMismatch(
  logger: Logger,
  reference: string,
  expectedAmount: number,
  body: Record<string, unknown>,
): boolean {
  const bodyRef =
    typeof body["reference_id"] === "string"
      ? body["reference_id"].trim()
      : undefined;
  if (bodyRef && bodyRef !== reference) {
    logger.warn(
      `Reference mismatch in Bold voucher sync: expected ${maskReference(reference)}, received ${maskReference(bodyRef)}. Skipping approval.`,
    );
    return true;
  }
  const voucherAmount = extractBoldVoucherAmount(body);
  const voucherCurrency = parseBoldCurrency(body["amount"] ?? body);
  return isBoldAmountOrCurrencyMismatch(
    logger,
    reference,
    expectedAmount,
    voucherAmount,
    voucherCurrency,
    "Bold voucher sync",
  );
}

async function readChunksBounded(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  chunks: Uint8Array[],
  total: number,
  maxBytes: number,
): Promise<{ ok: true; total: number } | { ok: false; reason: string }> {
  const { done, value } = await reader.read();
  if (done) {
    return { ok: true, total };
  }
  let nextTotal = total;
  if (value) {
    nextTotal += value.byteLength;
    if (nextTotal > maxBytes) {
      await reader.cancel().catch(() => {});
      return { ok: false, reason: "response_too_large" };
    }
    chunks.push(value);
  }
  return readChunksBounded(reader, chunks, nextTotal, maxBytes);
}

async function readBoundedResponseText(
  res: Response,
  maxBytes: number,
): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  const contentLength = res.headers.get("content-length");
  if (contentLength) {
    const parsed = Number(contentLength);
    if (Number.isFinite(parsed) && parsed > maxBytes) {
      return { ok: false, reason: "response_too_large" };
    }
  }

  if (!res.body) {
    const text = await res.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      return { ok: false, reason: "response_too_large" };
    }
    return { ok: true, text };
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  const readResult = await readChunksBounded(reader, chunks, 0, maxBytes);
  if (!readResult.ok) {
    return readResult;
  }

  const merged = new Uint8Array(readResult.total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: Buffer.from(merged).toString("utf8") };
}

/**
 * Hardened GET https://payments.api.bold.co/v2/payment-voucher/{order_id}
 * - Host allowlist + HTTPS enforcement
 * - redirect: "manual" (blocks 3xx credential leakage)
 * - 10s AbortSignal timeout + 1 MiB response size cap
 * - Secret redaction in logs
 */
export async function fetchBoldPaymentVoucher(
  configService: ConfigService<EnvironmentConfig>,
  logger: Logger,
  reference: string,
): Promise<BoldVoucherFetchResult> {
  const identityKey = resolveBoldIdentityKey(configService);
  if (!identityKey) {
    logger.warn("Cannot sync with Bold: BOLD_IDENTITY_KEY is not configured");
    return { ok: false, reason: "missing_identity_key" };
  }

  const trimmedRef = reference.trim();
  if (!BOLD_ORDER_ID_REGEX.test(trimmedRef)) {
    logger.warn(
      `Cannot sync with Bold: invalid reference format (${maskReference(trimmedRef)})`,
    );
    return { ok: false, reason: "invalid_reference" };
  }

  const url = new URL(
    `/v2/payment-voucher/${encodeURIComponent(trimmedRef)}`,
    BOLD_API_BASE_URL,
  );
  if (url.protocol !== "https:" || !BOLD_ALLOWED_HOSTS.has(url.hostname)) {
    return { ok: false, reason: "disallowed_host" };
  }

  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `x-api-key ${identityKey}`,
        Accept: "application/json",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(BOLD_FETCH_TIMEOUT_MS),
    });

    if (res.status >= 300 && res.status < 400) {
      logger.warn(
        `Bold voucher sync blocked unexpected redirect (${res.status}) for ref ${maskReference(trimmedRef)}`,
      );
      return { ok: false, status: res.status, reason: "redirect_blocked" };
    }

    if (!res.ok) {
      logger.warn(
        `Bold sync API returned ${res.status} for ref ${maskReference(trimmedRef)}`,
      );
      return { ok: false, status: res.status, reason: "http_error" };
    }

    const bounded = await readBoundedResponseText(res, MAX_BOLD_RESPONSE_BYTES);
    if (!bounded.ok) {
      logger.warn(
        `Bold sync API response exceeded ${MAX_BOLD_RESPONSE_BYTES} bytes for ref ${maskReference(trimmedRef)}`,
      );
      return { ok: false, reason: bounded.reason };
    }

    const parsed: unknown = JSON.parse(bounded.text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, reason: "invalid_json_object" };
    }
    return {
      ok: true,
      status: res.status,
      body: parsed as Record<string, unknown>,
    };
  } catch (err: unknown) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    const safeMsg = redactBoldSecrets(rawMsg, [identityKey]);
    logger.warn(
      `Bold sync failed for ref ${maskReference(trimmedRef)}: ${safeMsg}`,
    );
    return { ok: false, reason: safeMsg };
  }
}
