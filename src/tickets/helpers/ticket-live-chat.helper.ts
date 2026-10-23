import { Model } from "mongoose";
import { NotFoundException, BadRequestException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  TicketDocument,
  TicketStatus,
  TicketChannel,
  TicketInteractionMode,
  TicketMessage,
} from "../schemas/ticket.schema";
import { BirdWhatsappService } from "../../bird/bird-whatsapp.service";
import { BirdRealtimeService } from "../../bird/bird-realtime.service";

export interface LiveChatContext {
  ticketModel: Model<TicketDocument>;
  birdWhatsappService: BirdWhatsappService;
  birdRealtimeService: BirdRealtimeService;
}

export async function fetchLiveChats(
  ticketModel: Model<TicketDocument>,
): Promise<TicketDocument[]> {
  return ticketModel
    .find({
      channel: TicketChannel.WHATSAPP,
      status: {
        $in: [
          TicketStatus.NUEVO,
          TicketStatus.ABIERTO,
          TicketStatus.PENDIENTE,
          TicketStatus.EN_PROGRESO,
        ],
      },
    })
    .sort({ updatedAt: -1 })
    .limit(50)
    .exec();
}

export async function dispatchLiveChatMessage(
  params: {
    ticketId: string;
    text: string;
    actor: { userId: string; name: string; email: string };
  },
  ctx: LiveChatContext,
): Promise<TicketDocument> {
  const ticket = await ctx.ticketModel.findById(params.ticketId);
  if (!ticket) {
    throw new NotFoundException("Ticket no encontrado");
  }

  const cleanText = params.text.trim();
  if (!cleanText) {
    throw new BadRequestException("El mensaje no puede estar vacío");
  }

  const agentMsg: TicketMessage = {
    messageId: randomUUID(),
    sender: "agent",
    senderName: params.actor.name,
    senderEmail: params.actor.email,
    content: cleanText,
    isInternalNote: false,
    createdAt: new Date(),
  };

  ticket.messages.push(agentMsg);
  ticket.interactionMode = TicketInteractionMode.LIVE_AGENT;
  ticket.status = TicketStatus.EN_PROGRESO;
  ticket.sla.firstRespondedAt ??= new Date();

  ticket.auditLog.push({
    action: "live_chat_agent_reply",
    performedBy: params.actor.name,
    details: { snippet: cleanText.slice(0, 100) },
    timestamp: new Date(),
  });

  const saved = await ticket.save();

  if (ticket.customer.phone) {
    await ctx.birdWhatsappService.sendDirectWhatsapp({
      to: ticket.customer.phone,
      text: cleanText,
    });
  }

  if (ctx.birdRealtimeService.isRealtimeConfigured()) {
    void ctx.birdRealtimeService.publishToChannel(
      "private-admin",
      "support.live_chat_message",
      {
        ticketId: String(saved._id),
        ticketNumber: saved.ticketNumber,
        message: agentMsg,
        actor: params.actor,
      },
    );
  }

  return saved;
}

export async function changeInteractionMode(
  params: {
    ticketId: string;
    mode: TicketInteractionMode;
    actorName: string;
  },
  ctx: LiveChatContext,
): Promise<TicketDocument> {
  const ticket = await ctx.ticketModel.findById(params.ticketId);
  if (!ticket) {
    throw new NotFoundException("Ticket no encontrado");
  }

  const prevMode = ticket.interactionMode;
  ticket.interactionMode = params.mode;

  if (
    params.mode === TicketInteractionMode.CLOSED ||
    params.mode === TicketInteractionMode.BOT
  ) {
    if (prevMode === TicketInteractionMode.LIVE_AGENT) {
      const farewell = [
        "🏁 *ATENCIÓN EN VIVO FINALIZADA* 🏁",
        "",
        "Gracias por comunicarte con el Servicio al Cliente de *BSK Motorcycle Team*.",
        "Tu sesión de atención con nuestro asesor ha finalizado.",
        "",
        "Si requieres resolver otra duda en el futuro, solo escríbenos nuevamente por aquí y nuestro asistente automatizado te responderá 24/7.",
        "",
        "¡Buenas rutas y rueda siempre seguro! 🏍️💨",
      ].join("\n");

      if (ticket.customer.phone) {
        void ctx.birdWhatsappService.sendDirectWhatsapp({
          to: ticket.customer.phone,
          text: farewell,
        });
      }

      ticket.status = TicketStatus.RESUELTO;
      ticket.sla.resolvedAt = new Date();
    }
  }

  ticket.auditLog.push({
    action: "interaction_mode_changed",
    performedBy: params.actorName,
    details: { from: prevMode, to: params.mode },
    timestamp: new Date(),
  });

  const saved = await ticket.save();

  if (ctx.birdRealtimeService.isRealtimeConfigured()) {
    void ctx.birdRealtimeService.publishToChannel(
      "private-admin",
      "support.live_chat_mode_changed",
      {
        ticketId: String(saved._id),
        ticketNumber: saved.ticketNumber,
        mode: params.mode,
        status: saved.status,
        performedBy: params.actorName,
      },
    );
  }

  return saved;
}
