import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type {
  AlegraBillingContext,
  AlegraInvoiceCreate,
  AlegraNumberTemplate,
  AlegraPaymentCreate,
} from "./alegra.interfaces";
import {
  ALEGRA_KV_PREFIX,
  ALEGRA_TEMPLATE_CACHE_TTL,
  ALEGRA_CO_PAYMENT_FORM_CASH,
  ALEGRA_CO_INVOICE_TYPE_NATIONAL,
  ALEGRA_CO_OPERATION_TYPE_STANDARD,
  mapPaymentMethod,
} from "./alegra.constants";
import type { KvCacheService } from "../kv/kv-cache.service";
import type { EnvironmentConfig } from "../config/config.interface";

export type AlegraHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface AlegraCatalogItem {
  id: string | number;
  name?: string;
  reference?: string;
  status?: string;
  productKey?: string | null;
}

const UNSPSC_EIGHT_DIGITS_REGEX = /^\d{8}$/;

/**
 * Validates Colombia DIAN 2.1 UNSPSC productKey values stored on Alegra catalog items.
 * - `null`/empty is permitted (Alegra stamps with non-blocking FAZ09 observation).
 * - Non-empty values must be an 8-digit Level-4 Commodity code (never a Level-1/2/3
 *   Segment/Family/Class header ending in "00" such as "94121500", which Alegra
 *   rejects with HTTP 400 "El campo código del producto/servicio seleccionado es inválido").
 */
export function isInvalidUnspscProductKey(productKey?: string | null): boolean {
  if (productKey === null || productKey === undefined) return false;
  const trimmed = String(productKey).trim();
  if (trimmed.length === 0) return false;
  return !UNSPSC_EIGHT_DIGITS_REGEX.test(trimmed) || trimmed.endsWith("00");
}

function getBogotaDateString(): string {
  return new Date().toLocaleDateString("sv-SE", {
    timeZone: "America/Bogota",
  });
}

function getConfiguredId(
  configService: ConfigService<EnvironmentConfig>,
  key: keyof EnvironmentConfig,
): string | null {
  const val = configService.get(key, { infer: true });
  return typeof val === "string" && val.trim().length > 0 ? val.trim() : null;
}

function pickBestActiveItem(
  items: AlegraCatalogItem[] | null,
  logger?: Logger,
): AlegraCatalogItem | null {
  if (!Array.isArray(items) || items.length === 0) return null;
  const activeItems = items.filter((i) => i?.id && i.status !== "inactive");
  if (activeItems.length === 0) return null;

  const isPreferred = (i: AlegraCatalogItem): boolean =>
    i.reference === "BSKMT-GENERIC" ||
    Boolean(i.name?.toLowerCase().includes("ingreso bskmt"));

  const validItems = activeItems.filter(
    (i) => !isInvalidUnspscProductKey(i.productKey),
  );
  const preferredValid = validItems.find(isPreferred);
  if (preferredValid) return preferredValid;

  const preferredAny = activeItems.find(isPreferred);
  if (preferredAny && isInvalidUnspscProductKey(preferredAny.productKey)) {
    logger?.warn(
      `Alegra preferred catalog item id=${String(preferredAny.id)} has invalid UNSPSC productKey="${String(preferredAny.productKey)}" — skipping in favor of valid active item`,
    );
  }

  return validItems[0] ?? preferredAny ?? activeItems[0];
}

export async function discoverDefaultItemId(
  configService: ConfigService<EnvironmentConfig>,
  kvCache: KvCacheService,
  makeRequest: <T>(method: AlegraHttpMethod, path: string) => Promise<T | null>,
  logger: Logger,
): Promise<string | null> {
  const configured = getConfiguredId(configService, "ALEGRA_ITEM_ID");
  if (configured) return configured;

  const cacheKey = `${ALEGRA_KV_PREFIX}default_item_id`;
  const cached = await kvCache.get<string>(cacheKey, true);
  if (cached) return cached;

  try {
    const matched = await makeRequest<AlegraCatalogItem[]>(
      "GET",
      "/items?query=Ingreso%20BSKMT&limit=10",
    );
    const chosen =
      pickBestActiveItem(matched, logger) ??
      pickBestActiveItem(
        await makeRequest<AlegraCatalogItem[]>("GET", "/items?limit=30"),
        logger,
      );

    if (chosen?.id) {
      if (isInvalidUnspscProductKey(chosen.productKey)) {
        logger.warn(
          `Alegra auto-discovered item id=${String(chosen.id)} has invalid UNSPSC productKey="${String(chosen.productKey)}" — DIAN 2.1 stamping may fail until updated in Alegra`,
        );
      }
      const idStr = String(chosen.id);
      await kvCache.set(cacheKey, idStr, 86400, true);
      logger.log(
        `Alegra default item auto-discovered: id=${idStr} name="${chosen.name ?? ""}"`,
      );
      return idStr;
    }
  } catch (err) {
    logger.error(
      `Error discovering default item from Alegra API: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return null;
}

function isValidActiveElectronicTemplate(
  tpl: AlegraNumberTemplate,
  todayBogota: string,
): boolean {
  if (!tpl?.id) return false;
  if (tpl.documentType !== "invoice") return false;
  if (tpl.isElectronic !== true) return false;
  if (tpl.status === "inactive") return false;
  if (tpl.endDate && tpl.endDate < todayBogota) return false;
  return true;
}

export async function discoverElectronicNumberTemplateId(
  configService: ConfigService<EnvironmentConfig>,
  kvCache: KvCacheService,
  makeRequest: <T>(method: AlegraHttpMethod, path: string) => Promise<T | null>,
  logger: Logger,
): Promise<string | null> {
  const configured = getConfiguredId(
    configService,
    "ALEGRA_NUMBER_TEMPLATE_ID",
  );
  if (configured) return configured;

  const cacheKey = `${ALEGRA_KV_PREFIX}electronic_number_template_id`;
  const cached = await kvCache.get<string>(cacheKey, true);
  if (cached) return cached;

  try {
    const templates = await makeRequest<AlegraNumberTemplate[]>(
      "GET",
      "/number-templates",
    );
    if (!Array.isArray(templates) || templates.length === 0) return null;

    const todayBogota = getBogotaDateString();
    const eligible = templates.filter((t) =>
      isValidActiveElectronicTemplate(t, todayBogota),
    );
    const chosen = eligible.find((t) => t.isDefault === true) ?? eligible[0];

    if (chosen?.id) {
      const idStr = String(chosen.id);
      await kvCache.set(cacheKey, idStr, ALEGRA_TEMPLATE_CACHE_TTL, true);
      logger.log(
        `Alegra electronic number template discovered: id=${idStr} prefix=${chosen.prefix ?? ""}`,
      );
      return idStr;
    }
  } catch (err) {
    logger.error(
      `Error discovering electronic number template from Alegra API: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return null;
}

export async function discoverDefaultBankAccountId(
  configService: ConfigService<EnvironmentConfig>,
  kvCache: KvCacheService,
  makeRequest: <T>(method: AlegraHttpMethod, path: string) => Promise<T | null>,
  logger: Logger,
): Promise<string | null> {
  const configured = getConfiguredId(configService, "ALEGRA_BANK_ACCOUNT_ID");
  if (configured) return configured;

  const cacheKey = `${ALEGRA_KV_PREFIX}default_bank_account_id`;
  const cached = await kvCache.get<string>(cacheKey, true);
  if (cached) return cached;

  try {
    const accounts = await makeRequest<
      Array<{ id: string | number; name?: string; status?: string }>
    >("GET", "/bank-accounts?limit=30");
    const active = Array.isArray(accounts)
      ? accounts.filter((a) => a?.id && a.status !== "inactive")
      : [];
    const chosen =
      active.find((a) => a.name?.toUpperCase().includes("BOLD")) ?? active[0];
    if (chosen?.id) {
      const idStr = String(chosen.id);
      await kvCache.set(cacheKey, idStr, 86400, true);
      logger.log(
        `Alegra default bank account auto-discovered: id=${idStr} name="${chosen.name ?? ""}"`,
      );
      return idStr;
    }
  } catch (err) {
    logger.error(
      `Error discovering default bank account from Alegra API: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return null;
}

export async function discoverDefaultSellerId(
  configService: ConfigService<EnvironmentConfig>,
  kvCache: KvCacheService,
  makeRequest: <T>(method: AlegraHttpMethod, path: string) => Promise<T | null>,
  logger: Logger,
): Promise<string | null> {
  const configured = getConfiguredId(configService, "ALEGRA_SELLER_ID");
  if (configured) return configured;

  const cacheKey = `${ALEGRA_KV_PREFIX}default_seller_id`;
  const cached = await kvCache.get<string>(cacheKey, true);
  if (cached) return cached;

  try {
    const sellers = await makeRequest<
      Array<{ id: string | number; name?: string; status?: string }>
    >("GET", "/sellers?limit=30");
    const active = Array.isArray(sellers)
      ? sellers.filter((s) => s?.id && s.status !== "inactive")
      : [];
    const chosen =
      active.find(
        (s) =>
          s.name?.toUpperCase().includes("VENTAS") ||
          s.name?.toUpperCase().includes("BSKMT"),
      ) ?? active[0];
    if (chosen?.id) {
      const idStr = String(chosen.id);
      await kvCache.set(cacheKey, idStr, 86400, true);
      logger.log(
        `Alegra default seller auto-discovered: id=${idStr} name="${chosen.name ?? ""}"`,
      );
      return idStr;
    }
  } catch (err) {
    logger.error(
      `Error discovering default seller from Alegra API: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return null;
}

function buildFallbackReference(purpose: string): string {
  const clean = purpose.replace(/[^A-Za-z0-9_-]/g, "").toUpperCase();
  return `BSKMT-${clean || "GENERIC"}`.slice(0, 45);
}

export function buildInvoiceItems(
  context: AlegraBillingContext,
  itemId: string,
): AlegraInvoiceCreate["items"] {
  const fallbackRef = buildFallbackReference(context.purpose);
  if (context.items && context.items.length > 0) {
    const validItems = context.items.filter(
      (i) =>
        Number.isFinite(i.price) &&
        i.price > 0 &&
        Number.isFinite(i.quantity) &&
        i.quantity > 0,
    );
    const itemsSum = Math.round(
      validItems.reduce((sum, i) => sum + i.price * i.quantity, 0),
    );
    // Only emit itemized lines when their sum matches the paid amount so
    // Alegra POST /payments never fails with balance mismatch.
    if (
      validItems.length === context.items.length &&
      itemsSum === Math.round(context.amount)
    ) {
      return validItems.map((item) => ({
        id: itemId,
        name: String(item.name).slice(0, 150),
        description: item.description
          ? String(item.description).slice(0, 500)
          : undefined,
        reference: item.reference
          ? String(item.reference).slice(0, 45)
          : fallbackRef,
        price: item.price,
        quantity: item.quantity,
      }));
    }

    const summary = context.items
      .map((i) => `${i.quantity}x ${i.name}`)
      .join(", ")
      .slice(0, 500);
    return [
      {
        id: itemId,
        name: String(context.description).slice(0, 150),
        description: summary || undefined,
        reference: fallbackRef,
        price: context.amount,
        quantity: 1,
      },
    ];
  }

  return [
    {
      id: itemId,
      name: String(context.description).slice(0, 150),
      reference: fallbackRef,
      price: context.amount,
      quantity: 1,
    },
  ];
}

export function buildInvoicePayload(
  context: AlegraBillingContext,
  contactId: string,
  itemId: string,
  sellerId?: string | null,
  numberTemplateId?: string | null,
): AlegraInvoiceCreate {
  const dateStr = getBogotaDateString();
  const methodMapping = mapPaymentMethod(context.paymentMethod);

  const payload: AlegraInvoiceCreate = {
    date: dateStr,
    dueDate: dateStr,
    client: contactId,
    items: buildInvoiceItems(context, itemId),
    status: "open",
    observations: `BSKMT — Ref: ${context.transactionReference}`,
    termsConditions:
      "BSK Motorcycle Team — Factura electrónica generada automáticamente.",
    paymentMethod: methodMapping.invoice,
    paymentForm: ALEGRA_CO_PAYMENT_FORM_CASH,
    type: ALEGRA_CO_INVOICE_TYPE_NATIONAL,
    operationType: ALEGRA_CO_OPERATION_TYPE_STANDARD,
    stamp: { generateStamp: true },
  };

  if (sellerId) payload.seller = sellerId;
  if (numberTemplateId) payload.numberTemplate = { id: numberTemplateId };
  return payload;
}

export function buildPaymentPayload(
  invoiceId: string,
  amount: number,
  bankAccountId: string,
  paymentMethod?: string | null,
): AlegraPaymentCreate {
  const dateStr = getBogotaDateString();
  const methodMapping = mapPaymentMethod(paymentMethod);

  return {
    date: dateStr,
    bankAccount: bankAccountId,
    type: "in",
    paymentMethod: methodMapping.payment,
    invoices: [{ id: invoiceId, amount }],
  };
}
