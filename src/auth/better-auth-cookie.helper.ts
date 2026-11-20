export const BETTER_AUTH_SESSION_COOKIE_NAMES = new Set([
  "better-auth.session_token",
  "__Secure-better-auth.session_token",
]);

const SESSION_TOKEN_COOKIE_REGEX =
  /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=([^;\s]+)/;

/**
 * Decodifica un componente de cookie de forma segura sin lanzar URIError
 * ante secuencias porcentuales malformadas (previene DoS HTTP 500).
 */
export function safeDecodeCookieValue(raw: string): string {
  if (!raw.includes("%")) return raw;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Verifica de forma exacta (por nombre completo de cookie) si un header `Cookie`
 * contiene una cookie de sesión de Better Auth no vacía.
 */
export function hasSessionTokenCookie(
  cookieHeader: string | undefined,
): boolean {
  if (!cookieHeader) return false;
  return SESSION_TOKEN_COOKIE_REGEX.test(cookieHeader);
}

/**
 * Extrae el token crudo (sin firma HMAC) de la cookie de sesión de Better Auth
 * desde un header `Cookie` entrante.
 */
export function extractSessionTokenFromCookieHeader(
  cookieHeader: string | undefined,
): string | null {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(";");
  for (const rawEntry of cookies) {
    const entry = rawEntry.trim();
    const eq = entry.indexOf("=");
    if (eq <= 0) continue;
    const name = entry.slice(0, eq).trim();
    if (!BETTER_AUTH_SESSION_COOKIE_NAMES.has(name)) continue;
    const value = entry.slice(eq + 1).trim();
    if (!value) continue;
    const decoded = safeDecodeCookieValue(value);
    const tokenPart = decoded.split(".")[0]?.trim();
    if (tokenPart) return tokenPart;
  }
  return null;
}

/**
 * Extrae todos los tokens crudos de sesión de Better Auth desde una lista de
 * headers `Set-Cookie` (o pares `name=value`).
 */
export function extractAllSessionTokensFromSetCookies(
  setCookieHeaders: string[],
): string[] {
  const tokens: string[] = [];
  for (const sc of setCookieHeaders) {
    const semi = sc.indexOf(";");
    const pair = (semi === -1 ? sc : sc.slice(0, semi)).trim();
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    if (!BETTER_AUTH_SESSION_COOKIE_NAMES.has(name)) continue;
    const value = pair.slice(eq + 1).trim();
    if (!value) continue;
    const decoded = safeDecodeCookieValue(value);
    const tokenPart = decoded.split(".")[0]?.trim();
    if (tokenPart && !tokens.includes(tokenPart)) {
      tokens.push(tokenPart);
    }
  }
  return tokens;
}

/**
 * Extrae el primer token crudo de sesión de Better Auth desde una lista de
 * headers `Set-Cookie`.
 */
export function extractSessionTokenFromSetCookies(
  setCookieHeaders: string[],
): string | null {
  return extractAllSessionTokensFromSetCookies(setCookieHeaders)[0] ?? null;
}

/**
 * Ajusta el atributo `Max-Age` (y elimina `Expires` conflictivo) en las cookies
 * de sesión de Better Auth emitidas al completar la verificación OTP:
 * - Si `maxAgeSeconds` está definido (> 0), aplica exactamente ese tope (ej. 24h
 *   para cuentas privilegiadas staff/admin/superadmin aunque `rememberMe=true`).
 * - Si `maxAgeSeconds` es `undefined` (`rememberMe=false`), elimina `Max-Age` y
 *   `Expires` para emitir una verdadera cookie de sesión de navegador.
 */
export function rewriteSessionSetCookieMaxAge(
  setCookieHeaders: string[],
  maxAgeSeconds?: number,
): string[] {
  return setCookieHeaders.map((sc) => {
    const semi = sc.indexOf(";");
    const pair = (semi === -1 ? sc : sc.slice(0, semi)).trim();
    const eq = pair.indexOf("=");
    if (eq <= 0) return sc;
    const name = pair.slice(0, eq).trim();
    if (!BETTER_AUTH_SESSION_COOKIE_NAMES.has(name)) {
      return sc;
    }

    let rewritten = sc
      .replace(/;\s*Max-Age=[^;]*/gi, "")
      .replace(/;\s*Expires=[^;]*/gi, "");

    if (typeof maxAgeSeconds === "number" && maxAgeSeconds > 0) {
      rewritten = `${rewritten}; Max-Age=${Math.floor(maxAgeSeconds)}`;
    }
    return rewritten;
  });
}
