import { Logger } from "@nestjs/common";

const SIMPLE_EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const SYNTHETIC_INBOUND_DOMAIN = "@inbound.bskmt.com";

export function redactBirdSecrets(text: string): string {
  return text
    .replace(/b[km]_(us1|eu1)_[A-Za-z0-9._-]+/g, "b*_***_<REDACTED>")
    .replace(/whsec_[A-Za-z0-9+/=_-]+/g, "whsec_<REDACTED>");
}

export function isValidEmailRecipient(email?: string | null): boolean {
  if (!email || typeof email !== "string") return false;
  const trimmed = email.trim();
  if (!trimmed || trimmed.length > 254 || /[\r\n\0]/.test(trimmed)) {
    return false;
  }
  return SIMPLE_EMAIL_PATTERN.test(trimmed);
}

export function isSyntheticInboundEmail(email?: string | null): boolean {
  if (!email || typeof email !== "string") return false;
  return email.trim().toLowerCase().endsWith(SYNTHETIC_INBOUND_DOMAIN);
}

export function sanitizeEmailSubject(subject: string, maxLen = 200): string {
  const cleaned = subject
    .replace(/[\r\n\t\0]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= maxLen) return cleaned;
  return `${cleaned.slice(0, maxLen - 3)}...`;
}

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
    return redactBirdSecrets(parts.join(" "));
  }
  return redactBirdSecrets(String(err));
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

export function buildTicketAttachments(
  checkInCode: string,
  pdfBuffer?: Buffer,
):
  | Array<{ filename: string; content: string; content_type: string }>
  | undefined {
  if (!pdfBuffer) return undefined;
  return [
    {
      filename: `Ticket-BSK-${checkInCode}.pdf`,
      content: pdfBuffer.toString("base64"),
      content_type: "application/pdf",
    },
  ];
}

export function buildTicketSubject(type: string, title: string): string {
  return type === "EVENT"
    ? `¡Tu registro está confirmado! Pase de Asistencia BSK · ${title}`
    : `¡Tu matrícula está confirmada! Ticket Oficial BSK Academy · ${title}`;
}

export function getDefaultEmailSender(): {
  fromEmail: string;
  fromName: string;
  teamEmail: string;
} {
  return {
    fromEmail: process.env.BIRD_FROM_EMAIL ?? "no_responder@bskmt.com",
    fromName: process.env.BIRD_FROM_NAME ?? "BSK Motorcycle Team",
    teamEmail: process.env.BIRD_TEAM_EMAIL ?? "contacto@bskmt.com",
  };
}
