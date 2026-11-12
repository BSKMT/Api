import type { CookieOptions } from "express";
import { generateCsrfToken } from "./csrf.helper";

export interface CsrfCookieResponseLike {
  cookie: (name: string, value: string, options: CookieOptions) => unknown;
}

export const CSRF_COOKIE_NAME = "bskmt.csrf";
export const CSRF_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const resolveDevFallbackSecret = () => `dev-test-csrf-${process.pid}`;

/**
 * Resuelve el secreto HMAC para tokens CSRF desde ConfigService o env,
 * fallando en producción si falta tanto CSRF_SECRET como BETTER_AUTH_SECRET.
 */
export function resolveCsrfSecret(
  configSecret?: string,
  fallbackAuthSecret?: string,
): string {
  const isProd = process.env.NODE_ENV === "production";
  const secret =
    configSecret?.trim() ||
    fallbackAuthSecret?.trim() ||
    process.env.CSRF_SECRET?.trim() ||
    process.env.BETTER_AUTH_SECRET?.trim() ||
    "";

  if (!secret) {
    if (isProd) {
      throw new Error(
        "CSRF_SECRET or BETTER_AUTH_SECRET is required in production",
      );
    }
    return resolveDevFallbackSecret();
  }

  return secret;
}

/**
 * Genera un token CSRF firmado con HMAC-SHA256 y fija la cookie `bskmt.csrf`
 * con los atributos canónicos compartidos entre portales.
 */
export function issueCsrfCookie(
  res: CsrfCookieResponseLike,
  configSecret?: string,
  fallbackAuthSecret?: string,
): string {
  const isProd = process.env.NODE_ENV === "production";
  const token = generateCsrfToken(
    resolveCsrfSecret(configSecret, fallbackAuthSecret),
  );

  const options: CookieOptions = {
    httpOnly: false, // Accesible por JS para enviar en encabezado X-CSRF-Token
    secure: isProd,
    sameSite: "lax",
    domain: isProd ? ".bskmt.com" : undefined,
    path: "/",
    maxAge: CSRF_COOKIE_MAX_AGE_MS,
  };

  res.cookie(CSRF_COOKIE_NAME, token, options);
  return token;
}

/**
 * Extrae de forma segura todos los valores decodificados de cookies `bskmt.csrf`
 * presentes en un encabezado Cookie sin lanzar excepciones ante codificaciones inválidas.
 */
export function extractCsrfCookieTokens(cookieHeader: string | undefined): {
  tokens: string[];
  hasCookieEntry: boolean;
} {
  if (!cookieHeader) {
    return { tokens: [], hasCookieEntry: false };
  }

  const tokens: string[] = [];
  let hasCookieEntry = false;
  const regex = /(?:^|;\s*)bskmt\.csrf=([^;]*)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(cookieHeader)) !== null) {
    hasCookieEntry = true;
    try {
      const decoded = decodeURIComponent(match[1]);
      if (decoded && !tokens.includes(decoded)) {
        tokens.push(decoded);
      }
    } catch {
      // Ignorar codificación porcentual malformada sin caer en 500
    }
  }

  return { tokens, hasCookieEntry };
}
