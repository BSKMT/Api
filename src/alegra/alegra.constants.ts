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
 * Default tax ID for IVA (19%) in Colombia — this is typically
 * pre-configured in the Alegra account. The ID is fetched at runtime
 * from the Alegra tax catalog rather than hard-coded.
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
