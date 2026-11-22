/**
 * Alegra API constants.
 *
 * Base URL: https://api.alegra.com/api/v1 (production).
 * Authentication: Basic Access Authentication using base64(email:token).
 * Rate limit: 150 requests per minute per user (HTTP 429 when exceeded).
 * Pagination: `start` + `limit` (max 30 per page).
 */

export const ALEGRA_DEFAULT_API_URL = "https://api.alegra.com/api/v1";

export const ALEGRA_ALLOWED_API_HOSTS = new Set(["api.alegra.com"]);

export const ALEGRA_ALLOWED_PDF_HOSTS = ["cdn3.alegra.com", "alegra.com"];

export const ALEGRA_SAFE_ID_REGEX = /^[A-Za-z0-9_-]{1,64}$/;

export const ALEGRA_ALLOWED_PURPOSES = new Set([
  "membership",
  "event",
  "course",
  "shop",
  "arpha",
]);

export const ALEGRA_RATE_LIMIT_PER_MINUTE = 150;

export const ALEGRA_DEFAULT_TIMEOUT_MS = 30_000;

export const ALEGRA_MIN_TIMEOUT_MS = 5_000;

export const ALEGRA_MAX_TIMEOUT_MS = 60_000;

export const ALEGRA_PAGE_SIZE = 30;

/**
 * Stale-lock threshold (5 minutes) for recovering an abandoned PROCESSING claim.
 */
export const ALEGRA_PROCESSING_STALE_MS = 5 * 60 * 1000;

/**
 * Colombia-specific payment forms and invoice types accepted by Alegra DIAN 2.1.
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
 * KV cache TTL for electronic number template discovery (6 hours).
 */
export const ALEGRA_TEMPLATE_CACHE_TTL = 21_600;

/**
 * Mapping from BSKMT / Bold payment methods to valid Alegra Colombia DIAN 2.1
 * invoice `paymentMethod` enum values and `POST /payments` payment methods.
 *
 * DIAN 2.1 valid invoice paymentMethod values include:
 * CASH, CREDIT_CARD, DEBIT_CARD, DEBIT_TRANSFER, DEBIT_TRANSFER_BANK,
 * CREDIT_TRANSFER, BANK_DEPOSIT, CHECK, ACH_DEBIT, ACH_CREDIT,
 * INSTRUMENT_NOT_DEFINED, PROMISING_NOTE.
 */
export const ALEGRA_PAYMENT_METHOD_MAP: Record<
  string,
  { invoice: string; payment: string }
> = {
  CARD: { invoice: "CREDIT_CARD", payment: "credit-card" },
  CREDIT_CARD: { invoice: "CREDIT_CARD", payment: "credit-card" },
  DEBIT_CARD: { invoice: "DEBIT_CARD", payment: "debit-card" },
  PSE: { invoice: "DEBIT_TRANSFER", payment: "transfer" },
  NEQUI: { invoice: "DEBIT_TRANSFER", payment: "transfer" },
  DAVIPLATA: { invoice: "DEBIT_TRANSFER", payment: "transfer" },
  BOTON_BANCOLOMBIA: { invoice: "DEBIT_TRANSFER", payment: "transfer" },
  TRANSFER: { invoice: "DEBIT_TRANSFER", payment: "transfer" },
  DEPOSIT: { invoice: "BANK_DEPOSIT", payment: "deposit" },
  CASH: { invoice: "CASH", payment: "cash" },
  CREDIT: { invoice: "CASH", payment: "cash" },
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

export function isValidAlegraId(value: string | null | undefined): boolean {
  if (!value || typeof value !== "string") return false;
  return value !== "0" && ALEGRA_SAFE_ID_REGEX.test(value);
}

export function isAllowedAlegraPdfUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== "string") return false;
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== "https:") return false;
    if (parsed.username || parsed.password) return false;
    const host = parsed.hostname.toLowerCase();
    return ALEGRA_ALLOWED_PDF_HOSTS.some(
      (allowed) => host === allowed || host.endsWith(`.${allowed}`),
    );
  } catch {
    return false;
  }
}

/**
 * Maps internal technical Alegra errors to safe end-user messages (OWASP A05/A09).
 */
export function sanitizeAlegraErrorForUser(
  errorMessage?: string | null,
): string | null {
  if (!errorMessage) return null;
  const lower = errorMessage.toLowerCase();
  if (lower.includes("contact")) {
    return "No fue posible validar los datos fiscales del titular para la factura electrónica. Verifica tu perfil e intenta nuevamente.";
  }
  if (lower.includes("invoice") || lower.includes("dian")) {
    return "No fue posible emitir la factura electrónica ante la DIAN en este momento. Puedes reintentar desde este panel.";
  }
  return "Ocurrió un inconveniente temporal generando la factura electrónica. Puedes reintentar o contactar soporte.";
}
