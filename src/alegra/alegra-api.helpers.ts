import { Logger } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { EnvironmentConfig } from "../config/config.interface";
import type { KvCacheService } from "../kv/kv-cache.service";
import type {
  AlegraBillingContext,
  AlegraInvoiceResponse,
  AlegraPaymentResponse,
  CreatedInvoiceData,
} from "./alegra.interfaces";
import { maskReference, maskAmount } from "../common/utils/log-redact.util";
import {
  discoverDefaultItemId,
  discoverDefaultBankAccountId,
  buildInvoicePayload,
  buildPaymentPayload,
} from "./alegra-invoice.helpers";

export type AlegraRequestFn = <T>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
) => Promise<T | null>;

export async function executeCreateInvoice(
  makeRequest: AlegraRequestFn,
  configService: ConfigService<EnvironmentConfig>,
  kvCache: KvCacheService,
  context: AlegraBillingContext,
  contactId: string,
  logger: Logger,
): Promise<CreatedInvoiceData | null> {
  const sellerId =
    configService.get<string>("ALEGRA_SELLER_ID", { infer: true }) ||
    process.env.ALEGRA_SELLER_ID ||
    "";
  const itemId = await discoverDefaultItemId(
    configService,
    kvCache,
    makeRequest,
    logger,
  );

  if (!itemId) {
    logger.warn(
      "ALEGRA_ITEM_ID not configured and could not be auto-discovered — cannot create invoice",
    );
    return null;
  }

  const payload = buildInvoicePayload(context, contactId, itemId, sellerId);
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
    invoiceNumber: invoice.numberTemplate?.fullNumber ?? null,
    cufe: invoice.stamp?.cufe ?? null,
    stampStatus: invoice.stamp?.legalStatus ?? null,
  };

  logger.log(
    `Alegra invoice created: ref=${maskReference(context.transactionReference)} invoiceId=${invoice.id} cufe=${result.cufe ? "yes" : "no"}`,
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
): Promise<string | null> {
  if (amount <= 0) return null;

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

  const payload = buildPaymentPayload(invoiceId, amount, bankAccountId);
  const payment = await makeRequest<AlegraPaymentResponse>(
    "POST",
    "/payments",
    payload,
  );

  if (!payment?.id) {
    logger.warn(`Failed to create Alegra payment for invoiceId=${invoiceId}`);
    return null;
  }

  logger.log(
    `Alegra payment created: invoiceId=${invoiceId} paymentId=${payment.id} amount=${maskAmount(amount)}`,
  );
  return String(payment.id);
}

export async function executeEmailInvoice(
  makeRequest: AlegraRequestFn,
  invoiceId: string,
  logger: Logger,
): Promise<boolean> {
  const result = await makeRequest<unknown>(
    "POST",
    `/invoices/${invoiceId}/email`,
    {},
  );
  if (result === null) {
    logger.warn(`Failed to email Alegra invoice ${invoiceId}`);
    return false;
  }
  logger.log(`Alegra invoice emailed: invoiceId=${invoiceId}`);
  return true;
}

export async function executeGetInvoicePdfUrl(
  makeRequest: AlegraRequestFn,
  invoiceId: string,
  logger: Logger,
): Promise<string | null> {
  const invoice = await makeRequest<AlegraInvoiceResponse>(
    "GET",
    `/invoices/${invoiceId}?fields=pdf`,
  );
  if (!invoice?.pdf) {
    logger.warn(`Failed to get PDF URL for invoice ${invoiceId}`);
    return null;
  }
  return invoice.pdf;
}
