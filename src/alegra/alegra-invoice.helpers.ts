import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type {
  AlegraBillingContext,
  AlegraInvoiceCreate,
  AlegraPaymentCreate,
} from "./alegra.interfaces";
import {
  ALEGRA_KV_PREFIX,
  ALEGRA_CO_PAYMENT_FORM_CASH,
  ALEGRA_CO_INVOICE_TYPE_NATIONAL,
  ALEGRA_CO_OPERATION_TYPE_STANDARD,
} from "./alegra.constants";
import type { KvCacheService } from "../kv/kv-cache.service";
import type { EnvironmentConfig } from "../config/config.interface";

export async function discoverDefaultItemId(
  configService: ConfigService<EnvironmentConfig>,
  kvCache: KvCacheService,
  makeRequest: <T>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
  ) => Promise<T | null>,
  logger: Logger,
): Promise<string | null> {
  const configured =
    configService.get<string>("ALEGRA_ITEM_ID", { infer: true }) ||
    process.env.ALEGRA_ITEM_ID;
  if (configured) return configured;

  const cacheKey = `${ALEGRA_KV_PREFIX}default_item_id`;
  const cached = await kvCache.get<string>(cacheKey, true);
  if (cached) return cached;

  try {
    const items = await makeRequest<Array<{ id: string | number }>>(
      "GET",
      "/items?limit=1",
    );
    if (items && Array.isArray(items) && items.length > 0 && items[0].id) {
      const idStr = String(items[0].id);
      await kvCache.set(cacheKey, idStr, 86400, true);
      logger.log(`Alegra default item auto-discovered: id=${idStr}`);
      return idStr;
    }
  } catch {
    // ignore
  }
  return null;
}

export async function discoverDefaultBankAccountId(
  configService: ConfigService<EnvironmentConfig>,
  kvCache: KvCacheService,
  makeRequest: <T>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
  ) => Promise<T | null>,
  logger: Logger,
): Promise<string | null> {
  const configured =
    configService.get<string>("ALEGRA_BANK_ACCOUNT_ID", { infer: true }) ||
    process.env.ALEGRA_BANK_ACCOUNT_ID;
  if (configured) return configured;

  const cacheKey = `${ALEGRA_KV_PREFIX}default_bank_account_id`;
  const cached = await kvCache.get<string>(cacheKey, true);
  if (cached) return cached;

  try {
    const accounts = await makeRequest<Array<{ id: string | number }>>(
      "GET",
      "/bank-accounts?limit=1",
    );
    if (
      accounts &&
      Array.isArray(accounts) &&
      accounts.length > 0 &&
      accounts[0].id
    ) {
      const idStr = String(accounts[0].id);
      await kvCache.set(cacheKey, idStr, 86400, true);
      logger.log(`Alegra default bank account auto-discovered: id=${idStr}`);
      return idStr;
    }
  } catch {
    // ignore
  }
  return null;
}

export function buildInvoiceItems(
  context: AlegraBillingContext,
  itemId: string,
): AlegraInvoiceCreate["items"] {
  if (context.items && context.items.length > 0) {
    return context.items.map((item) => ({
      id: itemId,
      name: String(item.name).slice(0, 150),
      description: item.description
        ? String(item.description).slice(0, 500)
        : undefined,
      reference: item.reference
        ? String(item.reference).slice(0, 45)
        : undefined,
      price: item.price,
      quantity: item.quantity,
    }));
  }

  return [
    {
      id: itemId,
      name: String(context.description).slice(0, 150),
      price: context.amount,
      quantity: 1,
    },
  ];
}

export function buildInvoicePayload(
  context: AlegraBillingContext,
  contactId: string,
  itemId: string,
  sellerId?: string,
): AlegraInvoiceCreate {
  const dateStr = new Date().toLocaleDateString("sv-SE", {
    timeZone: "America/Bogota",
  });

  const payload: AlegraInvoiceCreate = {
    date: dateStr,
    dueDate: dateStr,
    client: contactId,
    items: buildInvoiceItems(context, itemId),
    status: "open",
    observations: `BSKMT — Ref: ${context.transactionReference}`,
    termsConditions:
      "BSK Motorcycle Team — Factura electrónica generada automáticamente.",
    paymentMethod: "CASH",
    paymentForm: ALEGRA_CO_PAYMENT_FORM_CASH,
    type: ALEGRA_CO_INVOICE_TYPE_NATIONAL,
    operationType: ALEGRA_CO_OPERATION_TYPE_STANDARD,
    stamp: { generateStamp: true },
  };

  if (sellerId) payload.seller = sellerId;
  return payload;
}

export function buildPaymentPayload(
  invoiceId: string,
  amount: number,
  bankAccountId: string,
): AlegraPaymentCreate {
  const dateStr = new Date().toLocaleDateString("sv-SE", {
    timeZone: "America/Bogota",
  });

  return {
    date: dateStr,
    bankAccount: bankAccountId,
    type: "in",
    paymentMethod: "CASH",
    invoices: [{ id: invoiceId, amount }],
  };
}
