import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import {
  Ticket,
  TicketDocument,
  TicketStatus,
  TicketPriority,
  TicketChannel,
  TicketInteractionMode,
} from "./schemas/ticket.schema";
import { CreateTicketDto } from "./dto/create-ticket.dto";
import { TicketReplyDto } from "./dto/ticket-reply.dto";
import { TicketQueryDto } from "./dto/ticket-query.dto";
import { sendTicketReplyNotifications } from "./helpers/ticket-notification.helper";
import {
  applyTicketReply,
  applyTicketStatus,
  applyTicketPriority,
  extractUserName,
} from "./helpers/ticket-actions.helper";
import { executeCreateTicket } from "./helpers/ticket-creation.helper";
import { processInboundMessage } from "./helpers/ticket-inbound.helper";
import {
  fetchLiveChats,
  dispatchLiveChatMessage,
  changeInteractionMode,
} from "./helpers/ticket-live-chat.helper";
import {
  queryTickets,
  findTicketById,
  findTicketsForUser,
} from "./helpers/ticket-queries.helper";
import { aggregateTicketStats } from "./helpers/ticket-stats.helper";
import { BirdEmailService } from "../bird/bird-email.service";
import { BirdContactService } from "../bird/bird-contact.service";
import { BirdSmsService } from "../bird/bird-sms.service";
import { BirdWhatsappService } from "../bird/bird-whatsapp.service";
import { BirdRealtimeService } from "../bird/bird-realtime.service";
import { UsersService } from "../users/users.service";
import { WhatsappBotService } from "./whatsapp-bot.service";

@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name);

  constructor(
    @InjectModel(Ticket.name)
    private readonly ticketModel: Model<TicketDocument>,
    private readonly birdEmailService: BirdEmailService,
    private readonly birdContactService: BirdContactService,
    private readonly usersService: UsersService,
    private readonly birdSmsService: BirdSmsService,
    private readonly birdWhatsappService: BirdWhatsappService,
    private readonly birdRealtimeService: BirdRealtimeService,
    private readonly whatsappBotService: WhatsappBotService,
  ) {}

  async createTicket(
    dto: CreateTicketDto,
    actor?: { userId?: string; name?: string; email?: string },
    clientIp?: string,
  ): Promise<TicketDocument> {
    return executeCreateTicket(
      dto,
      {
        ticketModel: this.ticketModel,
        birdEmailService: this.birdEmailService,
        birdContactService: this.birdContactService,
        birdSmsService: this.birdSmsService,
        birdWhatsappService: this.birdWhatsappService,
        birdRealtimeService: this.birdRealtimeService,
        logger: this.logger,
      },
      actor,
      clientIp,
    );
  }

  async replyTicket(
    ticketId: string,
    dto: TicketReplyDto,
    actor: { userId: string; name: string; email: string; isAgent: boolean },
  ): Promise<TicketDocument> {
    const ticket = await this.ticketModel.findById(ticketId);
    if (!ticket) {
      throw new NotFoundException("Ticket de soporte no encontrado");
    }

    const { isInternal } = applyTicketReply(ticket, dto, actor);
    if (actor.isAgent) {
      void sendTicketReplyNotifications(
        {
          birdEmailService: this.birdEmailService,
          birdSmsService: this.birdSmsService,
          birdWhatsappService: this.birdWhatsappService,
          birdRealtimeService: this.birdRealtimeService,
          logger: this.logger,
        },
        ticket,
        dto.content,
        actor.name,
        {
          isInternal,
          sendSms: dto.sendSms,
          sendWhatsapp: dto.sendWhatsapp,
        },
      );
    }
    return ticket.save();
  }

  async handleInboundMessage(params: {
    channel: TicketChannel;
    from: string;
    to: string;
    text: string;
    senderName?: string;
    messageId?: string;
  }): Promise<TicketDocument> {
    return processInboundMessage(params, {
      ticketModel: this.ticketModel,
      usersService: this.usersService,
      birdWhatsappService: this.birdWhatsappService,
      birdSmsService: this.birdSmsService,
      birdRealtimeService: this.birdRealtimeService,
      whatsappBotService: this.whatsappBotService,
      logger: this.logger,
    });
  }

  async getLiveChats(): Promise<TicketDocument[]> {
    return fetchLiveChats(this.ticketModel);
  }

  async sendLiveChatMessage(
    ticketId: string,
    text: string,
    actor: { userId: string; name: string; email: string },
  ): Promise<TicketDocument> {
    return dispatchLiveChatMessage(
      { ticketId, text, actor },
      {
        ticketModel: this.ticketModel,
        birdWhatsappService: this.birdWhatsappService,
        birdRealtimeService: this.birdRealtimeService,
      },
    );
  }

  async updateTicketInteractionMode(
    ticketId: string,
    mode: TicketInteractionMode,
    actorName: string,
  ): Promise<TicketDocument> {
    return changeInteractionMode(
      { ticketId, mode, actorName },
      {
        ticketModel: this.ticketModel,
        birdWhatsappService: this.birdWhatsappService,
        birdRealtimeService: this.birdRealtimeService,
      },
    );
  }

  async updateStatus(
    ticketId: string,
    status: TicketStatus,
    actorName: string,
  ): Promise<TicketDocument> {
    const ticket = await this.ticketModel.findById(ticketId);
    if (!ticket) throw new NotFoundException("Ticket no encontrado");
    applyTicketStatus(ticket, status, actorName);
    return ticket.save();
  }

  async updatePriority(
    ticketId: string,
    priority: TicketPriority,
    actorName: string,
  ): Promise<TicketDocument> {
    const ticket = await this.ticketModel.findById(ticketId);
    if (!ticket) throw new NotFoundException("Ticket no encontrado");
    applyTicketPriority(ticket, priority, actorName);
    return ticket.save();
  }

  async assignTicket(
    ticketId: string,
    assigneeUserId: string,
    actorName: string,
  ): Promise<TicketDocument> {
    const ticket = await this.ticketModel.findById(ticketId);
    if (!ticket) throw new NotFoundException("Ticket no encontrado");

    const assignee = await this.usersService.findById(assigneeUserId);
    if (!assignee) {
      throw new NotFoundException("Usuario asignado no encontrado");
    }

    ticket.assignedTo = {
      userId: String(assignee._id),
      name: extractUserName(assignee),
      email: assignee.email,
    };
    if (ticket.status === TicketStatus.NUEVO) {
      ticket.status = TicketStatus.ABIERTO;
    }
    ticket.auditLog.push({
      action: "ticket_assigned",
      performedBy: actorName,
      details: { assigneeName: ticket.assignedTo.name },
      timestamp: new Date(),
    });
    return ticket.save();
  }

  async findAll(query: TicketQueryDto): Promise<{
    tickets: TicketDocument[];
    total: number;
    page: number;
    limit: number;
  }> {
    return queryTickets(this.ticketModel, query);
  }

  async findById(
    ticketId: string,
    isStaffOrAdmin: boolean,
  ): Promise<TicketDocument> {
    return findTicketById(this.ticketModel, ticketId, isStaffOrAdmin);
  }

  async findForUser(userId: string): Promise<TicketDocument[]> {
    return findTicketsForUser(this.ticketModel, userId);
  }

  async getStats(): Promise<Record<string, unknown>> {
    return aggregateTicketStats(this.ticketModel);
  }

  async deleteTicket(ticketId: string): Promise<{ deleted: boolean }> {
    const res = await this.ticketModel.findByIdAndDelete(ticketId).exec();
    if (!res) throw new NotFoundException("Ticket no encontrado");
    return { deleted: true };
  }
}
