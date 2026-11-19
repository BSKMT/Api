import { BadRequestException, Logger } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";

const ATTESTATION_MAX_AGE_SEC = 60;
const HEX_SHA256_REGEX = /^[0-9a-f]{64}$/i;

/**
 * Verifies a cryptographic HMAC-SHA256 Turnstile attestation header signed by a trusted
 * first-party edge Worker (`New-LandingPage`) using the shared `TURNSTILE_SECRET_KEY`.
 * Format: `<unix-seconds>.<hex-hmac-sha256(secret, "${ts}:${action}:${clientIp}:${requestId}")>`
 */
export function verifyTurnstileAttestation(
  headerValue: string | string[] | undefined,
  action: string,
  clientIp: string,
  requestId: string,
): boolean {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) return false;

  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (!raw || typeof raw !== "string") return false;

  const dotIdx = raw.indexOf(".");
  if (dotIdx <= 0) return false;
  const tsStr = raw.slice(0, dotIdx);
  const sigHex = raw.slice(dotIdx + 1).trim();

  if (!/^\d{10,13}$/.test(tsStr) || !HEX_SHA256_REGEX.test(sigHex)) {
    return false;
  }

  const ts = Number(tsStr);
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > ATTESTATION_MAX_AGE_SEC) {
    return false;
  }

  const ipCandidates = [clientIp || "unknown", "unknown"];
  const providedBuf = Buffer.from(sigHex.toLowerCase(), "utf8");
  for (const ipVal of ipCandidates) {
    const expectedHex = createHmac("sha256", secret)
      .update(`${tsStr}:${action}:${ipVal}:${requestId}`)
      .digest("hex");
    const expectedBuf = Buffer.from(expectedHex, "utf8");
    if (
      providedBuf.length === expectedBuf.length &&
      timingSafeEqual(providedBuf, expectedBuf)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Verifica el token de Cloudflare Turnstile contra el endpoint oficial `siteverify`.
 *
 * Seguridad (VULN-13 / OWASP A07:2025):
 * - Si `TURNSTILE_SECRET_KEY` está configurada en el entorno, el token es ESTRICTAMENTE
 *   OBLIGATORIO.
 * - Si `TURNSTILE_SECRET_KEY` no está configurada en producción, falla cerrado (fail-closed).
 */
export async function verifyTurnstileToken(
  token: string | undefined,
  ip?: string,
  logger?: Logger,
): Promise<void> {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      logger?.error("TURNSTILE_SECRET_KEY missing in production environment");
      throw new BadRequestException("Error de configuración de seguridad");
    }
    return;
  }

  if (!token || typeof token !== "string" || token.trim().length < 10) {
    logger?.warn("Turnstile verification failed: missing or invalid token");
    throw new BadRequestException(
      "Completa la verificación de seguridad (Turnstile) para continuar.",
    );
  }

  try {
    const body = new URLSearchParams({
      secret,
      response: token.trim(),
    });
    if (ip) {
      body.set("remoteip", ip);
    }

    const res = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(8_000),
      },
    );

    const data = (await res.json().catch(() => ({}))) as {
      success?: boolean;
    };

    if (!data.success) {
      logger?.warn(
        "Turnstile siteverify failed — challenge rejected the token",
      );
      throw new BadRequestException(
        "No pudimos verificar que eres humano. Intenta de nuevo.",
      );
    }
  } catch (err) {
    if (err instanceof BadRequestException) {
      throw err;
    }
    logger?.warn(
      `Turnstile siteverify network error: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw new BadRequestException(
      "No se pudo verificar la prueba humana. Intenta más tarde.",
    );
  }
}
