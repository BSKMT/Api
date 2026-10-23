import { createHmac } from "node:crypto";
import { Logger, ForbiddenException } from "@nestjs/common";
import type { BirdWebhookEvent } from "./bird.service";
import type { TicketsService } from "../tickets/tickets.service";
import { TicketChannel } from "../tickets/schemas/ticket.schema";

export function assertChannelAuthorized(
  channelName: string,
  betterAuthId: string,
  userId?: string,
  role = "user",
): void {
  if (
    channelName.startsWith("private-user-") ||
    channelName.startsWith("presence-user-")
  ) {
    const channelOwner = channelName.startsWith("private-user-")
      ? channelName.slice("private-user-".length)
      : channelName.slice("presence-user-".length);
    const isOwner =
      channelOwner === betterAuthId ||
      (Boolean(userId) && channelOwner === userId);
    if (!isOwner && role !== "admin") {
      throw new ForbiddenException(
        "No tienes autorización para unirte a este canal personal de usuario",
      );
    }
    return;
  }

  if (
    channelName.startsWith("private-admin") ||
    channelName.startsWith("presence-admin")
  ) {
    if (role !== "admin") {
      throw new ForbiddenException(
        "Acceso denegado a canales de administración",
      );
    }
    return;
  }

  if (
    channelName.startsWith("presence-event-") ||
    channelName === "presence-community" ||
    channelName === "presence-chat"
  ) {
    return;
  }

  throw new ForbiddenException(
    `Canal no reconocido o no autorizado para suscripción: ${channelName}`,
  );
}

export function signMemberAuth(
  key: string,
  secret: string,
  connectionId: string,
  memberId: string,
  role = "user",
  displayName = "",
): { auth: string; member_data: string } {
  const memberData = JSON.stringify({
    member_id: memberId,
    member_info: { name: displayName, role },
  });

  const toSign = `${connectionId}::member::${memberData}`;
  const sig = createHmac("sha256", secret).update(toSign).digest("hex");

  return { auth: `${key}:${sig}`, member_data: memberData };
}

export function signChannelAuth(
  key: string,
  secret: string,
  connectionId: string,
  channelName: string,
  memberId?: string,
  role = "user",
  displayName = "",
): { auth: string; member_data?: string } {
  if (channelName.startsWith("presence-") && memberId) {
    const memberData = JSON.stringify({
      member_id: memberId,
      member_info: { name: displayName, role },
    });
    const toSign = `${connectionId}:${channelName}:${memberData}`;
    const sig = createHmac("sha256", secret).update(toSign).digest("hex");
    return { auth: `${key}:${sig}`, member_data: memberData };
  }

  const toSign = `${connectionId}:${channelName}`;
  const sig = createHmac("sha256", secret).update(toSign).digest("hex");
  return { auth: `${key}:${sig}` };
}

type WebhookEntity = Record<string, unknown> | string | undefined;

function extractPhoneNumber(entity: WebhookEntity, fallback = ""): string {
  if (typeof entity === "string") return entity;
  if (typeof entity === "object" && entity !== null) {
    const num = entity.phone_number;
    if (typeof num === "string") return num;
  }
  return fallback;
}

function extractDisplayName(entity: WebhookEntity): string | undefined {
  if (typeof entity === "object" && entity !== null) {
    if (typeof entity.display_name === "string") return entity.display_name;
    if (typeof entity.name === "string") return entity.name;
  }
  return undefined;
}

function extractEmailAddress(entity: WebhookEntity): string {
  if (typeof entity === "string") return entity;
  if (typeof entity === "object" && entity !== null) {
    if (typeof entity.email === "string") return entity.email;
  }
  return "";
}

function handlePresenceEvent(logger: Logger, event: BirdWebhookEvent): void {
  const memberId =
    typeof event.data.member_id === "string" ? event.data.member_id : "";
  const channel =
    typeof event.data.channel === "string" ? event.data.channel : "";

  switch (event.type) {
    case "realtime.member_added":
      logger.log(
        `realtime.member_added: member=${memberId}, channel=${channel}`,
      );
      break;
    case "realtime.member_removed":
      logger.log(
        `realtime.member_removed: member=${memberId}, channel=${channel}`,
      );
      break;
    case "realtime.channel_occupied":
      logger.debug(`realtime.channel_occupied: channel=${channel}`);
      break;
    case "realtime.channel_vacated":
      logger.debug(`realtime.channel_vacated: channel=${channel}`);
      break;
    default:
      break;
  }
}

async function handleWhatsAppReceived(
  logger: Logger,
  event: BirdWebhookEvent,
  ticketsService?: TicketsService,
): Promise<void> {
  const fromObj = event.data.from as WebhookEntity;
  const toObj = event.data.to as WebhookEntity;
  const senderPhone = extractPhoneNumber(fromObj);
  const senderName = extractDisplayName(fromObj);
  const receiver = extractPhoneNumber(toObj, "+573169588444");

  const textObj = event.data.text as { body?: string } | undefined;
  let bodyText = textObj?.body;
  if (!bodyText && typeof event.data.body === "string") {
    bodyText = event.data.body;
  }
  if (!bodyText && typeof event.data.message === "string") {
    bodyText = event.data.message;
  }

  const messageId =
    (typeof event.data.whatsapp_id === "string"
      ? event.data.whatsapp_id
      : undefined) ??
    (typeof event.data.id === "string" ? event.data.id : undefined);

  if (senderPhone && bodyText && ticketsService) {
    await ticketsService.handleInboundMessage({
      channel: TicketChannel.WHATSAPP,
      from: senderPhone,
      to: receiver,
      text: bodyText,
      senderName,
      messageId,
    });
  } else {
    logger.warn(
      `whatsapp.received omitido: datos insuficientes o TicketsService no disponible`,
    );
  }
}

async function handleSmsReceived(
  logger: Logger,
  event: BirdWebhookEvent,
  ticketsService?: TicketsService,
): Promise<void> {
  const senderPhone =
    (typeof event.data.from === "string" && event.data.from) ||
    (typeof event.data.originator === "string" && event.data.originator) ||
    (typeof event.data.source === "string" && event.data.source) ||
    "";
  const receiver =
    typeof event.data.to === "string" ? event.data.to : "901444BSKMT";

  const bodyText =
    (typeof event.data.text === "string" && event.data.text) ||
    (typeof event.data.body === "string" && event.data.body) ||
    (typeof event.data.message === "string" && event.data.message) ||
    "";
  const messageId =
    (typeof event.data.sms_id === "string" ? event.data.sms_id : undefined) ??
    (typeof event.data.id === "string" ? event.data.id : undefined);

  if (senderPhone && bodyText && ticketsService) {
    await ticketsService.handleInboundMessage({
      channel: TicketChannel.SMS,
      from: senderPhone,
      to: receiver,
      text: bodyText,
      messageId,
    });
  } else {
    logger.warn(
      `sms.received omitido: datos insuficientes o TicketsService no disponible`,
    );
  }
}

async function handleEmailReceived(
  event: BirdWebhookEvent,
  ticketsService?: TicketsService,
): Promise<void> {
  const fromObj = event.data.from as WebhookEntity;
  const fromEmail = extractEmailAddress(fromObj);
  const senderName = extractDisplayName(fromObj);
  const bodyText =
    (typeof event.data.text === "string" && event.data.text) ||
    (typeof event.data.subject === "string" && event.data.subject) ||
    "Mensaje de correo entrante";
  const messageId =
    (typeof event.data.email_id === "string"
      ? event.data.email_id
      : undefined) ??
    (typeof event.data.id === "string" ? event.data.id : undefined);

  if (fromEmail && ticketsService) {
    await ticketsService.handleInboundMessage({
      channel: TicketChannel.EMAIL,
      from: fromEmail,
      to: "contacto@bskmt.com",
      text: bodyText,
      senderName,
      messageId,
    });
  }
}

export async function processBirdWebhookEvent(
  logger: Logger,
  event: BirdWebhookEvent,
  ticketsService?: TicketsService,
): Promise<void> {
  logger.debug(
    `processWebhookEvent: type=${event.type}, data=${JSON.stringify(event.data).slice(0, 200)}`,
  );

  if (event.type.startsWith("realtime.")) {
    handlePresenceEvent(logger, event);
    return;
  }

  if (event.type === "whatsapp.received") {
    await handleWhatsAppReceived(logger, event, ticketsService);
    return;
  }

  if (event.type === "sms.received") {
    await handleSmsReceived(logger, event, ticketsService);
    return;
  }

  if (
    event.type === "email.received" ||
    event.type === "email_mailbox.message_received"
  ) {
    await handleEmailReceived(event, ticketsService);
    return;
  }

  logger.debug(`Unhandled webhook type: ${event.type}`);
}
