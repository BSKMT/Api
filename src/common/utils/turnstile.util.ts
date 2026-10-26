import { BadRequestException, Logger } from "@nestjs/common";

/**
 * Verifica el token de Cloudflare Turnstile contra el endpoint oficial `siteverify`.
 *
 * Seguridad (VULN-13 / OWASP A07:2025):
 * - Si `TURNSTILE_SECRET_KEY` está configurada en el entorno, el token es ESTRICTAMENTE
 *   OBLIGATORIO (cierra el bypass `if (!secret || !token) return;` donde omitir el campo
 *   saltaba la validación).
 * - Si `TURNSTILE_SECRET_KEY` no está configurada en desarrollo/test, opera en modo no-op.
 */
export async function verifyTurnstileToken(
  token: string | undefined,
  ip?: string,
  logger?: Logger,
): Promise<void> {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) {
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
