import { Logger } from "@nestjs/common";
import { Model } from "mongoose";
import { randomUUID } from "node:crypto";
import {
  TicketDocument,
  TicketStatus,
  TicketPriority,
  TicketChannel,
  TicketCategory,
  TicketInteractionMode,
} from "../schemas/ticket.schema";
import { computeInitialSLA } from "./ticket-sla.helper";
import { generateTicketNumber } from "./ticket-actions.helper";
import { UsersService } from "../../users/users.service";
import { BirdWhatsappService } from "../../bird/bird-whatsapp.service";
import { BirdSmsService } from "../../bird/bird-sms.service";
import { BirdRealtimeService } from "../../bird/bird-realtime.service";
import { WhatsappBotService } from "../whatsapp-bot.service";
import {
  resolveInboundCustomer,
  dispatchInboundAutoResponse,
} from "./ticket-inbound-customer.helper";

export { resolveInboundCustomer, dispatchInboundAutoResponse };

export interface InboundContext {
  ticketModel: Model<TicketDocument>;
  usersService: UsersService;
  birdWhatsappService: BirdWhatsappService;
  birdSmsService: BirdSmsService;
  birdRealtimeService: BirdRealtimeService;
  whatsappBotService: WhatsappBotService;
  logger: Logger;
}

export async function processInboundMessage(
  params: {
    channel: TicketChannel;
    from: string;
    to: string;
    text: string;
    senderName?: string;
    messageId?: string;
  },
  ctx: InboundContext,
): Promise<TicketDocument> {
  const { channel, from, to, text, senderName, messageId } = params;
  ctx.logger.log(
    `handleInboundMessage: canal=${channel}, remitente=${from}, mensaje="${text.slice(0, 50)}..."`,
  );

  const { customerName, customerEmail, customerPhone, userId } =
    await resolveInboundCustomer(
      { channel, from, senderName },
      ctx.usersService,
    );

  const queryFilter: Record<string, unknown> = {
    status: {
      $in: [
        TicketStatus.NUEVO,
        TicketStatus.ABIERTO,
        TicketStatus.PENDIENTE,
        TicketStatus.EN_PROGRESO,
      ],
    },
  };
  if (channel === TicketChannel.EMAIL) {
    queryFilter["customer.email"] = customerEmail;
  } else {
    queryFilter.$or = [
      { "customer.phone": customerPhone },
      { "customer.email": customerEmail },
      { "metadata.from": from },
    ];
  }

  let ticket = await ctx.ticketModel
    .findOne(queryFilter)
    .sort({ updatedAt: -1 });

  const incomingMsg = {
    messageId: messageId || randomUUID(),
    sender: "customer" as const,
    senderName: customerName,
    senderEmail: customerEmail,
    content: text,
    isInternalNote: false,
    createdAt: new Date(),
  };

  if (ticket) {
    ticket.messages.push(incomingMsg);
    ticket.status = TicketStatus.ABIERTO;
    ticket.auditLog.push({
      action: `inbound_${channel}_received`,
      performedBy: customerName,
      details: { from, to, snippet: text.slice(0, 100) },
      timestamp: new Date(),
    });
    const saved = await ticket.save();

    const isLiveChat =
      saved.interactionMode === TicketInteractionMode.LIVE_AGENT;

    if (ctx.birdRealtimeService.isRealtimeConfigured()) {
      void ctx.birdRealtimeService.publishToChannel(
        "private-admin",
        "support.ticket_message_received",
        {
          ticketId: String(saved._id),
          ticketNumber: saved.ticketNumber,
          channel,
          from,
          text,
          customer: saved.customer,
          isLiveChat,
        },
      );
    }

    if (channel === TicketChannel.WHATSAPP && !isLiveChat) {
      void ctx.whatsappBotService.processInboundWhatsappMessage({
        ticket: saved,
        text,
        customerName,
        customerPhone: customerPhone || from,
      });
    }

    ctx.logger.log(
      `Mensaje entrante agregado a Ticket existente #${saved.ticketNumber} [modo=${saved.interactionMode}]`,
    );
    return saved;
  }

  const ticketNumber = await generateTicketNumber(ctx.ticketModel);
  const priority = TicketPriority.MEDIA;
  const sla = computeInitialSLA(priority);

  ticket = new ctx.ticketModel({
    ticketNumber,
    subject: `Consulta ${channel.toUpperCase()}: ${text.slice(0, 45)}${text.length > 45 ? "..." : ""}`,
    description: text,
    category: TicketCategory.GENERAL,
    priority,
    status: TicketStatus.NUEVO,
    channel,
    interactionMode: TicketInteractionMode.BOT,
    botState: "MAIN",
    customer: {
      name: customerName,
      email: customerEmail,
      phone: customerPhone,
      userId,
    },
    messages: [incomingMsg],
    auditLog: [
      {
        action: `ticket_created_via_${channel}`,
        performedBy: customerName,
        details: { from, to },
        timestamp: new Date(),
      },
    ],
    tags: [channel, "inbound_auto"],
    sla,
    metadata: { from, to, messageId },
  });

  const saved = await ticket.save();

  if (ctx.birdRealtimeService.isRealtimeConfigured()) {
    void ctx.birdRealtimeService.publishToChannel(
      "private-admin",
      "support.ticket_created",
      {
        ticketId: String(saved._id),
        ticketNumber: saved.ticketNumber,
        subject: saved.subject,
        category: saved.category,
        priority: saved.priority,
        status: saved.status,
        channel: saved.channel,
        customer: saved.customer,
        createdAt: saved.createdAt,
      },
    );
  }

  if (channel === TicketChannel.WHATSAPP) {
    void ctx.whatsappBotService.processInboundWhatsappMessage({
      ticket: saved,
      text,
      customerName,
      customerPhone: customerPhone || from,
    });
  } else {
    dispatchInboundAutoResponse(
      channel,
      saved.ticketNumber,
      customerName,
      customerPhone,
      ctx.birdWhatsappService,
      ctx.birdSmsService,
    );
  }

  ctx.logger.log(
    `Nuevo Ticket #${saved.ticketNumber} creado automáticamente vía ${channel}`,
  );
  return saved;
}
