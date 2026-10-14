import { Logger } from "@nestjs/common";

export function formatBirdError(err: unknown): string {
  if (err instanceof Error) {
    const parts: string[] = [err.message];
    const errAny = err as unknown as Record<string, unknown>;
    if (typeof errAny["status"] === "number") {
      parts.push(`(HTTP ${errAny["status"]})`);
    }
    if (typeof errAny["code"] === "string") {
      parts.push(`[code: ${errAny["code"]}]`);
    }
    if (typeof errAny["response"] === "object" && errAny["response"] !== null) {
      try {
        const body = JSON.stringify(errAny["response"]);
        parts.push(`body: ${body.slice(0, 200)}`);
      } catch {
        // Ignorar cuerpo no serializable
      }
    }
    return parts.join(" ");
  }
  return String(err);
}

export async function renderWithFallback(
  renderFn: () => Promise<{ html: string; text?: string }>,
  fallbackFn: () => string,
  logger: Logger,
  contextLabel: string,
): Promise<{ html: string; text?: string }> {
  try {
    return await renderFn();
  } catch (renderErr) {
    logger.warn(
      `Error en React Email (${contextLabel}): ${renderErr instanceof Error ? renderErr.message : String(renderErr)}. Usando plantilla de respaldo.`,
    );
    return {
      html: fallbackFn(),
    };
  }
}
