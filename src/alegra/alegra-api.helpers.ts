import { Logger } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { EnvironmentConfig } from "../config/config.interface";
import type { KvCacheService } from "../kv/kv-cache.service";
import type {
  AlegraBillingContext,
  AlegraInvoicePdfDetails,
  AlegraInvoiceResponse,
  AlegraPaymentResponse,
  CreatedInvoiceData,
} from "./alegra.interfaces";
import {
  maskReference,
  maskAmount,
  maskEmail,
  sanitizeForLog,
} from "../common/utils/log-redact.util";
import { isAllowedAlegraPdfUrl, isValidAlegraId } from "./alegra.constants";
import type {
  AlegraDetailedRequestFn,
  AlegraHttpMethod,
} from "./alegra-http.client";
import {
  discoverDefaultItemId,
  discoverDefaultBankAccountId,
  discoverDefaultSellerId,
  discoverElectronicNumberTemplateId,
  buildInvoicePayload,
  buildPaymentPayload,
} from "./alegra-invoice.helpers";

export type AlegraRequestFn = <T>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
) => Promise<T | null>;

export interface CreateInvoiceDetailedResult {
  data: CreatedInvoiceData | null;
  errorCode: string | null;
}

const BASIC_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseAlegraErrorCode(errorText: string | null): number | null {
  if (!errorText) return null;
  try {
    const parsed = JSON.parse(errorText) as { code?: unknown };
    return typeof parsed.code === "number" && Number.isFinite(parsed.code)
      ? parsed.code
      : null;
  } catch {
    return null;
  }
}

export function classifyAlegraCreateInvoiceError(
  status: number,
  errorText: string | null,
): string {
  const providerCode = parseAlegraErrorCode(errorText);
  if (status === 402 || providerCode === 900) {
    return "ALEGRA_HTTP_402_PLAN_LIMIT";
  }
  if (status === 401 || status === 403) {
    return "ALEGRA_HTTP_AUTH_ERROR";
  }
  if (status === 429) {
    return "ALEGRA_HTTP_429_RATE_LIMIT";
  }
  if (status >= 400) {
    return providerCode !== null
      ? `ALEGRA_HTTP_${status}_CODE_${providerCode}`
      : `ALEGRA_HTTP_${status}`;
  }
  return "Failed to create invoice";
}

function extractInvoiceNumber(
  numberTemplate?: AlegraInvoiceResponse["numberTemplate"],
): string | null {
  if (!numberTemplate) return null;
  if (numberTemplate.fullNumber) return numberTemplate.fullNumber;
  if (numberTemplate.prefix) {
    return `${numberTemplate.prefix}${numberTemplate.number ?? ""}`;
  }
  return null;
}

export async function executeCreateInvoiceDetailed(
  makeRequest: AlegraRequestFn,
  makeDetailedRequest: AlegraDetailedRequestFn,
  configService: ConfigService<EnvironmentConfig>,
  kvCache: KvCacheService,
  context: AlegraBillingContext,
  contactId: string,
  logger: Logger,
): Promise<CreateInvoiceDetailedResult> {
  const [sellerId, itemId, numberTemplateId] = await Promise.all([
    discoverDefaultSellerId(configService, kvCache, makeRequest, logger),
    discoverDefaultItemId(configService, kvCache, makeRequest, logger),
    discoverElectronicNumberTemplateId(
      configService,
      kvCache,
      makeRequest,
      logger,
    ),
  ]);

  if (!itemId) {
    logger.warn(
      "ALEGRA_ITEM_ID not configured and could not be auto-discovered — cannot create invoice",
    );
    return { data: null, errorCode: "Failed to create invoice: missing item" };
  }

  const payload = buildInvoicePayload(
    context,
    contactId,
    itemId,
    sellerId,
    numberTemplateId,
  );
  const res = await makeDetailedRequest<AlegraInvoiceResponse>(
    "POST",
    "/invoices",
    payload,
  );

  if (!res.ok || !res.data?.id) {
    const errorCode = classifyAlegraCreateInvoiceError(
      res.status,
      res.errorText,
    );
    logger.warn(
      `Failed to create Alegra invoice for ref=${maskReference(context.transactionReference)} (${errorCode})`,
    );
    return { data: null, errorCode };
  }

  const invoice = res.data;
  const result: CreatedInvoiceData = {
    invoiceId: String(invoice.id),
    invoiceNumber: extractInvoiceNumber(invoice.numberTemplate),
    cufe: invoice.stamp?.cufe ?? null,
    stampStatus: invoice.stamp?.legalStatus ?? null,
  };

  logger.log(
    `Alegra invoice created: ref=${maskReference(context.transactionReference)} invoiceId=${sanitizeForLog(result.invoiceId)} cufe=${result.cufe ? "yes" : "no"}`,
  );
  return { data: result, errorCode: null };
}

export async function executeCreateInvoice(
  makeRequest: AlegraRequestFn,
  configService: ConfigService<EnvironmentConfig>,
  kvCache: KvCacheService,
  context: AlegraBillingContext,
  contactId: string,
  logger: Logger,
): Promise<CreatedInvoiceData | null> {
  const detailed = await executeCreateInvoiceDetailed(
    makeRequest,
    async <T>(method: AlegraHttpMethod, path: string, body?: unknown) => {
      const data = await makeRequest<T>(method, path, body);
      return {
        ok: data !== null,
        status: data !== null ? 200 : 0,
        data,
        errorText: null,
      };
    },
    configService,
    kvCache,
    context,
    contactId,
    logger,
  );
  return detailed.data;
}

export async function executeCreatePayment(
  makeRequest: AlegraRequestFn,
  configService: ConfigService<EnvironmentConfig>,
  kvCache: KvCacheService,
  invoiceId: string,
  amount: number,
  logger: Logger,
  paymentMethod?: string | null,
): Promise<string | null> {
  if (amount <= 0 || !isValidAlegraId(invoiceId)) return null;

  const bankAccountId = await discoverDefaultBankAccountId(
    configService,
    kvCache,
    makeRequest,
    logger,
  );

  if (!bankAccountId) {
    logger.warn(
      "ALEGRA_BANK_ACCOUNT_ID not configured and could not be auto-discovered — payment not recorded",
    );
    return null;
  }

  const payload = buildPaymentPayload(
    invoiceId,
    amount,
    bankAccountId,
    paymentMethod,
  );
  const payment = await makeRequest<AlegraPaymentResponse>(
    "POST",
    "/payments",
    payload,
  );

  if (!payment?.id) {
    logger.warn(
      `Failed to create Alegra payment for invoiceId=${sanitizeForLog(invoiceId)}`,
    );
    return null;
  }

  logger.log(
    `Alegra payment created: invoiceId=${sanitizeForLog(invoiceId)} paymentId=${sanitizeForLog(String(payment.id))} amount=${maskAmount(amount)}`,
  );
  return String(payment.id);
}

export async function executeEmailInvoice(
  makeRequest: AlegraRequestFn,
  invoiceId: string,
  recipientEmail: string | null | undefined,
  logger: Logger,
): Promise<boolean> {
  if (!isValidAlegraId(invoiceId)) {
    logger.warn("Invalid Alegra invoiceId — skipping email dispatch");
    return false;
  }
  const cleanEmail = recipientEmail?.trim() ?? "";
  if (!cleanEmail || !BASIC_EMAIL_REGEX.test(cleanEmail)) {
    logger.warn(
      `Missing or invalid recipient email for Alegra invoiceId=${sanitizeForLog(invoiceId)} — skipping email`,
    );
    return false;
  }

  const encodedId = encodeURIComponent(invoiceId);
  const result = await makeRequest<unknown>(
    "POST",
    `/invoices/${encodedId}/email`,
    {
      emails: [cleanEmail],
    },
  );
  if (result === null) {
    logger.warn(
      `Failed to email Alegra invoiceId=${sanitizeForLog(invoiceId)} to=${maskEmail(cleanEmail)}`,
    );
    return false;
  }
  logger.log(
    `Alegra invoice emailed: invoiceId=${sanitizeForLog(invoiceId)} to=${maskEmail(cleanEmail)}`,
  );
  return true;
}

export async function executeGetInvoicePdfDetails(
  makeRequest: AlegraRequestFn,
  invoiceId: string,
  logger: Logger,
): Promise<AlegraInvoicePdfDetails | null> {
  if (!isValidAlegraId(invoiceId)) {
    logger.warn("Rejected invalid Alegra invoiceId for PDF retrieval");
    return null;
  }

  const encodedId = encodeURIComponent(invoiceId);
  const invoice = await makeRequest<AlegraInvoiceResponse>(
    "GET",
    `/invoices/${encodedId}?fields=pdf`,
  );
  if (!invoice?.pdf) {
    logger.warn(
      `Failed to get PDF URL for invoiceId=${sanitizeForLog(invoiceId)}`,
    );
    return null;
  }

  if (!isAllowedAlegraPdfUrl(invoice.pdf)) {
    logger.warn(
      `Blocked untrusted PDF URL host returned for invoiceId=${sanitizeForLog(invoiceId)}`,
    );
    return null;
  }

  return {
    pdfUrl: invoice.pdf,
    invoiceNumber: extractInvoiceNumber(invoice.numberTemplate),
    cufe: invoice.stamp?.cufe ?? null,
    stampStatus: invoice.stamp?.legalStatus ?? null,
    status: invoice.status ?? null,
    balance: typeof invoice.balance === "number" ? invoice.balance : null,
  };
}

export async function executeGetInvoicePdfUrl(
  makeRequest: AlegraRequestFn,
  invoiceId: string,
  logger: Logger,
): Promise<string | null> {
  const details = await executeGetInvoicePdfDetails(
    makeRequest,
    invoiceId,
    logger,
  );
  return details?.pdfUrl ?? null;
}
