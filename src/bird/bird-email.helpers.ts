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
