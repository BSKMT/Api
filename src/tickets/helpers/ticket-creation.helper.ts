import { Logger, BadRequestException } from "@nestjs/common";
import { Model } from "mongoose";
import { randomUUID } from "node:crypto";
import {
  TicketDocument,
  TicketStatus,
  TicketPriority,
  TicketChannel,
} from "../schemas/ticket.schema";
import { CreateTicketDto } from "../dto/create-ticket.dto";
import { computeInitialSLA } from "./ticket-sla.helper";
import { generateTicketNumber } from "./ticket-actions.helper";
import {
  syncTicketCustomerWithBird,
  sendTicketCreationNotifications,
} from "./ticket-notification.helper";
import { BirdEmailService } from "../../bird/bird-email.service";
import { BirdContactService } from "../../bird/bird-contact.service";
import { BirdSmsService } from "../../bird/bird-sms.service";
import { BirdWhatsappService } from "../../bird/bird-whatsapp.service";
import { BirdRealtimeService } from "../../bird/bird-realtime.service";

export interface TicketCreationContext {
  ticketModel: Model<TicketDocument>;
  birdEmailService: BirdEmailService;
  birdContactService: BirdContactService;
  birdSmsService: BirdSmsService;
  birdWhatsappService: BirdWhatsappService;
  birdRealtimeService: BirdRealtimeService;
  logger: Logger;
}

export async function executeCreateTicket(
  dto: CreateTicketDto,
  ctx: TicketCreationContext,
  actor?: { userId?: string; name?: string; email?: string },
  clientIp?: string,
): Promise<TicketDocument> {
  const ticketNumber = await generateTicketNumber(ctx.ticketModel);
  const priority = dto.priority || TicketPriority.MEDIA;
  const sla = computeInitialSLA(priority);

  const customerName = dto.customerName || actor?.name || "Usuario BSKMT";
  const customerEmail = (dto.customerEmail || actor?.email || "")
    .toLowerCase()
    .trim();
  if (!customerEmail) {
    throw new BadRequestException("El correo del cliente es obligatorio");
  }

  const birdContactId = await syncTicketCustomerWithBird(
    ctx.birdContactService,
    {
      name: customerName,
      email: customerEmail,
      phone: dto.customerPhone,
      userId: actor?.userId,
    },
    ctx.logger,
  );

  const initialMessage = {
    messageId: randomUUID(),
    sender: "customer" as const,
    senderName: customerName,
    senderEmail: customerEmail,
    content: dto.description,
    isInternalNote: false,
    createdAt: new Date(),
  };

  const ticket = new ctx.ticketModel({
    ticketNumber,
    subject: dto.subject,
    description: dto.description,
    category: dto.category,
    priority,
    status: TicketStatus.NUEVO,
    channel: dto.channel || TicketChannel.WEB_CONTACT,
    customer: {
      name: customerName,
      email: customerEmail,
      phone: dto.customerPhone || null,
      userId: actor?.userId || null,
      birdContactId: birdContactId || null,
    },
    messages: [initialMessage],
    auditLog: [
      {
        action: "ticket_created",
        performedBy: customerName,
        details: { channel: dto.channel, priority, category: dto.category },
        timestamp: new Date(),
      },
    ],
    tags: dto.tags || [],
    sla,
    metadata: { clientIp },
  });

  const saved = await ticket.save();
  void sendTicketCreationNotifications(
    {
      birdEmailService: ctx.birdEmailService,
      birdSmsService: ctx.birdSmsService,
      birdWhatsappService: ctx.birdWhatsappService,
      birdRealtimeService: ctx.birdRealtimeService,
      logger: ctx.logger,
    },
    saved,
  );
  return saved;
}
