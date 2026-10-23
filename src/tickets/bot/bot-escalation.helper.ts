import { Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  TicketDocument,
  TicketInteractionMode,
  TicketStatus,
} from "../schemas/ticket.schema";
import { BirdWhatsappService } from "../../bird/bird-whatsapp.service";
import { BirdRealtimeService } from "../../bird/bird-realtime.service";
import { BotProcessResult } from "./bot.types";
import { getEscalationReplyText } from "./bot-texts-main";

export interface EscalationParams {
  ticket: TicketDocument;
  userPrompt: string;
  customerName: string;
  customerPhone: string;
  birdWhatsappService: BirdWhatsappService;
  birdRealtimeService: BirdRealtimeService;
  logger: Logger;
}

/**
 * Transfiere el ticket a modo LIVE_AGENT y notifica al cliente y a los gestores en tiempo real
 */
export async function executeEscalationToLiveAgent(
  params: EscalationParams,
): Promise<BotProcessResult> {
  const {
    ticket,
    userPrompt,
    customerName,
    customerPhone,
    birdWhatsappService,
    birdRealtimeService,
    logger,
  } = params;

  ticket.interactionMode = TicketInteractionMode.LIVE_AGENT;
  ticket.status = TicketStatus.ABIERTO;
  ticket.auditLog.push({
    action: "escalated_to_live_agent",
    performedBy: customerName,
    details: { prompt: userPrompt, phone: customerPhone },
    timestamp: new Date(),
  });

  const replyText = getEscalationReplyText(customerName);

  ticket.messages.push({
    messageId: randomUUID(),
    sender: "system",
    senderName: "Asistente Virtual BSKMT",
    content:
      "Conversación transferida a Asesor en Vivo. Modo live_agent activado.",
    isInternalNote: false,
    createdAt: new Date(),
  });
  await ticket.save();

  await birdWhatsappService.sendDirectWhatsapp({
    to: customerPhone,
    text: replyText,
  });

  if (birdRealtimeService.isRealtimeConfigured()) {
    void birdRealtimeService.publishToChannel(
      "private-admin",
      "support.live_chat_requested",
      {
        ticketId: String(ticket._id),
        ticketNumber: ticket.ticketNumber,
        customer: ticket.customer,
        userPrompt,
        timestamp: new Date(),
      },
    );
    void birdRealtimeService.publishToChannel(
      "private-admin",
      "support.ticket_message_received",
      {
        ticketId: String(ticket._id),
        ticketNumber: ticket.ticketNumber,
        channel: "whatsapp",
        from: customerPhone,
        text: userPrompt,
        customer: ticket.customer,
        isLiveChat: true,
      },
    );
  }

  logger.log(
    `Ticket #${ticket.ticketNumber} transferido exitosamente a ASESOR EN VIVO para ${customerPhone}`,
  );

  return {
    replyText,
    nextState: "LIVE_AGENT",
    escalatedToLiveAgent: true,
  };
}
