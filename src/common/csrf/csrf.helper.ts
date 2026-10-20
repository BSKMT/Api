import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";

const CSRF_HMAC_PURPOSE = "bskmt-csrf-token-v1";

/**
 * Genera un token anti-CSRF criptográficamente firmado (NIST CSF 2.0 PR.PS-06).
 * Formato: `<random_bytes_hex>.<hmac_signature_hex>`.
 */
export function generateCsrfToken(secret: string): string {
  const rawRandom = randomBytes(24).toString("hex");
  const hmacKey = createHmac("sha256", secret)
    .update(CSRF_HMAC_PURPOSE)
    .digest();
  const signature = createHmac("sha256", hmacKey)
    .update(rawRandom)
    .digest("hex");
  return `${rawRandom}.${signature}`;
}

/**
 * Valida la autenticidad e integridad del token CSRF mediante firma HMAC de tiempo constante.
 */
export function verifyCsrfToken(
  token: string | undefined,
  secret: string,
): boolean {
  if (!token || typeof token !== "string") return false;

  const dotIndex = token.indexOf(".");
  if (dotIndex <= 0 || dotIndex === token.length - 1) return false;

  const rawRandom = token.slice(0, dotIndex);
  const providedSignature = token.slice(dotIndex + 1);

  const hmacKey = createHmac("sha256", secret)
    .update(CSRF_HMAC_PURPOSE)
    .digest();
  const expectedSignature = createHmac("sha256", hmacKey)
    .update(rawRandom)
    .digest("hex");

  const bufProvided = Buffer.from(providedSignature, "utf8");
  const bufExpected = Buffer.from(expectedSignature, "utf8");

  if (bufProvided.length !== bufExpected.length) {
    return false;
  }

  return timingSafeEqual(bufProvided, bufExpected);
}

/**
 * Valida un token Double-Submit Cookie:
 * 1. Verifica la firma HMAC del token en el header (X-CSRF-Token).
 * 2. Verifica la firma HMAC del token en la cookie (bskmt.csrf).
 * 3. Compara en tiempo constante que ambos tokens coincidan exactamente.
 */
export function validateDoubleSubmitCsrf(
  headerToken: string | undefined,
  cookieToken: string | undefined,
  secret: string,
): boolean {
  if (!headerToken || !cookieToken) return false;

  // Ambos deben ser tokens válidos y legítimos firmados por nuestro backend
  if (
    !verifyCsrfToken(headerToken, secret) ||
    !verifyCsrfToken(cookieToken, secret)
  ) {
    return false;
  }

  const bufHeader = Buffer.from(headerToken, "utf8");
  const bufCookie = Buffer.from(cookieToken, "utf8");

  if (bufHeader.length !== bufCookie.length) {
    return false;
  }

  return timingSafeEqual(bufHeader, bufCookie);
}
