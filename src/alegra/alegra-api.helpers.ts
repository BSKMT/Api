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

const BASIC_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

export async function executeCreateInvoice(
  makeRequest: AlegraRequestFn,
  configService: ConfigService<EnvironmentConfig>,
  kvCache: KvCacheService,
  context: AlegraBillingContext,
  contactId: string,
  logger: Logger,
): Promise<CreatedInvoiceData | null> {
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
    return null;
  }

  const payload = buildInvoicePayload(
    context,
    contactId,
    itemId,
    sellerId,
    numberTemplateId,
  );
  const invoice = await makeRequest<AlegraInvoiceResponse>(
    "POST",
    "/invoices",
    payload,
  );

  if (!invoice?.id) {
    logger.warn(
      `Failed to create Alegra invoice for ref=${maskReference(context.transactionReference)}`,
    );
    return null;
  }

  const result: CreatedInvoiceData = {
    invoiceId: String(invoice.id),
    invoiceNumber: extractInvoiceNumber(invoice.numberTemplate),
    cufe: invoice.stamp?.cufe ?? null,
    stampStatus: invoice.stamp?.legalStatus ?? null,
  };

  logger.log(
    `Alegra invoice created: ref=${maskReference(context.transactionReference)} invoiceId=${sanitizeForLog(result.invoiceId)} cufe=${result.cufe ? "yes" : "no"}`,
  );
  return result;
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
