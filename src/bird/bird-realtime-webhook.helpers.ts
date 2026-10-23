import { Logger } from "@nestjs/common";
import type { BirdWebhookEvent } from "./bird-realtime.interfaces";
import type { TicketsService } from "../tickets/tickets.service";
import { TicketChannel } from "../tickets/schemas/ticket.schema";

function getNestedProperty(obj: unknown, path: string): string | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const part of parts) {
    if (
      cur &&
      typeof cur === "object" &&
      part in (cur as Record<string, unknown>)
    ) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return typeof cur === "string" ? cur : undefined;
}

export function extractInboundMessageFromWebhook(event: BirdWebhookEvent): {
  channel: TicketChannel;
  from: string;
  to: string;
  text: string;
  senderName?: string;
  messageId?: string;
} | null {
  const eventName = (event.event || "").toLowerCase();
  const entity = event.entity || {};

  let channel: TicketChannel | null = null;
  if (
    eventName.includes("whatsapp") ||
    eventName.includes("message.created") ||
    entity["channel"] === "whatsapp" ||
    entity["platform"] === "whatsapp"
  ) {
    channel = TicketChannel.WHATSAPP;
  } else if (eventName.includes("sms") || entity["channel"] === "sms") {
    channel = TicketChannel.SMS;
  } else if (eventName.includes("email") || entity["channel"] === "email") {
    channel = TicketChannel.EMAIL;
  }

  const direction =
    (entity["direction"] as string | undefined) ||
    (entity["status"] as string | undefined) ||
    "";
  const isInbound =
    direction.toLowerCase() === "received" ||
    direction.toLowerCase() === "inbound" ||
    eventName.includes("received") ||
    eventName.includes("inbound");

  if (!isInbound && !eventName.includes("message")) {
    return null;
  }

  const from =
    getNestedProperty(entity, "from.phoneNumber") ||
    getNestedProperty(entity, "from.email") ||
    getNestedProperty(entity, "from.id") ||
    (typeof entity["from"] === "string" ? entity["from"] : "") ||
    getNestedProperty(entity, "originator") ||
    getNestedProperty(entity, "sender") ||
    "";

  const to =
    getNestedProperty(entity, "to.phoneNumber") ||
    getNestedProperty(entity, "to.email") ||
    (typeof entity["to"] === "string" ? entity["to"] : "") ||
    getNestedProperty(entity, "recipient") ||
    "";

  const text =
    getNestedProperty(entity, "body.text.text") ||
    getNestedProperty(entity, "text.body") ||
    getNestedProperty(entity, "body") ||
    getNestedProperty(entity, "text") ||
    getNestedProperty(entity, "content.text") ||
    getNestedProperty(entity, "message") ||
    "";

  if (!from || !text) {
    return null;
  }

  const senderName =
    getNestedProperty(entity, "from.displayName") ||
    getNestedProperty(entity, "from.name") ||
    getNestedProperty(entity, "senderName") ||
    undefined;

  const messageId =
    (entity["id"] as string | undefined) ||
    (entity["messageId"] as string | undefined) ||
    undefined;

  return {
    channel: channel || TicketChannel.WHATSAPP,
    from,
    to,
    text,
    senderName,
    messageId,
  };
}

export async function handleWebhookInboundMessage(
  event: BirdWebhookEvent,
  ticketsService: TicketsService | undefined,
  logger: Logger,
): Promise<void> {
  if (!ticketsService) {
    logger.debug(
      "TicketsService no está disponible para procesar mensaje entrante de webhook",
    );
    return;
  }

  try {
    const extracted = extractInboundMessageFromWebhook(event);
    if (!extracted) {
      return;
    }

    logger.log(
      `Mensaje entrante detectado vía Webhook Bird (${extracted.channel}) de ${extracted.from}`,
    );

    await ticketsService.handleInboundMessage({
      channel: extracted.channel,
      from: extracted.from,
      to: extracted.to,
      text: extracted.text,
      senderName: extracted.senderName,
      messageId: extracted.messageId,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(
      `Error al procesar mensaje entrante de webhook en TicketsService: ${msg}`,
    );
  }
}

export async function processBirdWebhookEvent(
  logger: Logger,
  event: BirdWebhookEvent,
  ticketsService?: TicketsService,
): Promise<void> {
  return handleWebhookInboundMessage(event, ticketsService, logger);
}
