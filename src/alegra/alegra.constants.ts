/**
 * Alegra API constants.
 *
 * Base URL: https://api.alegra.com/api/v1 (production).
 * Authentication: Basic Access Authentication using base64(email:token).
 * Rate limit: 150 requests per minute per user (HTTP 429 when exceeded).
 * Pagination: `start` + `limit` (max 30 per page).
 */

export const ALEGRA_DEFAULT_API_URL = "https://api.alegra.com/api/v1";

export const ALEGRA_RATE_LIMIT_PER_MINUTE = 150;

export const ALEGRA_DEFAULT_TIMEOUT_MS = 30_000;

export const ALEGRA_PAGE_SIZE = 30;

/**
 * Colombia-specific payment methods accepted by Alegra
 * (from Docs_Alegra/Catalogo de parámetros por país/Colombia).
 */
export const ALEGRA_CO_PAYMENT_FORM_CASH = "CASH";
export const ALEGRA_CO_PAYMENT_FORM_CREDIT = "CREDIT";

export const ALEGRA_CO_INVOICE_TYPE_NATIONAL = "NATIONAL";
export const ALEGRA_CO_INVOICE_TYPE_EXPORT = "EXPORT";

export const ALEGRA_CO_OPERATION_TYPE_STANDARD = "STANDARD";

/**
 * Default tax ID for IVA (19%) in Colombia. BSKMT is simplified regime (no responsable IVA).
 */
export const ALEGRA_CO_DEFAULT_TAX_PERCENTAGE = 19;

/**
 * Prefix for Alegra-related KV cache keys.
 */
export const ALEGRA_KV_PREFIX = "alegra:";

/**
 * KV cache TTL for Alegra contact lookups (1 hour).
 */
export const ALEGRA_CONTACT_CACHE_TTL = 3600;

/**
 * Mapping from BSKMT / Bold payment methods to Alegra invoice and payment methods.
 */
export const ALEGRA_PAYMENT_METHOD_MAP: Record<
  string,
  { invoice: string; payment: string }
> = {
  CARD: { invoice: "CREDIT_CARD", payment: "credit-card" },
  CREDIT_CARD: { invoice: "CREDIT_CARD", payment: "credit-card" },
  DEBIT_CARD: { invoice: "DEBIT_CARD", payment: "debit-card" },
  PSE: { invoice: "DEBIT_CARD", payment: "debit-card" },
  NEQUI: { invoice: "TRANSFER", payment: "transfer" },
  DAVIPLATA: { invoice: "TRANSFER", payment: "transfer" },
  BOTON_BANCOLOMBIA: { invoice: "TRANSFER", payment: "transfer" },
  TRANSFER: { invoice: "TRANSFER", payment: "transfer" },
  DEPOSIT: { invoice: "TRANSFER", payment: "deposit" },
  CASH: { invoice: "CASH", payment: "cash" },
};

export function mapPaymentMethod(method?: string | null): {
  invoice: string;
  payment: string;
} {
  if (!method) return { invoice: "CASH", payment: "cash" };
  const normalized = method
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  return (
    ALEGRA_PAYMENT_METHOD_MAP[normalized] ?? {
      invoice: "CASH",
      payment: "cash",
    }
  );
}
