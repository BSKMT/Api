import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { randomUUID } from "node:crypto";
import {
  Ticket,
  TicketDocument,
  TicketStatus,
  TicketPriority,
  TicketChannel,
} from "./schemas/ticket.schema";
import { CreateTicketDto } from "./dto/create-ticket.dto";
import { TicketReplyDto } from "./dto/ticket-reply.dto";
import { TicketQueryDto } from "./dto/ticket-query.dto";
import {
  computeInitialSLA,
  evaluateSlaBreach,
} from "./helpers/ticket-sla.helper";
import { buildTicketFilter } from "./helpers/ticket-query.helper";
import {
  syncTicketCustomerWithBird,
  sendTicketCreationEmail,
  sendTicketReplyEmail,
} from "./helpers/ticket-notification.helper";
import {
  generateTicketNumber,
  applyTicketReply,
  applyTicketStatus,
  applyTicketPriority,
  extractUserName,
} from "./helpers/ticket-actions.helper";
import { BirdEmailService } from "../bird/bird-email.service";
import { BirdContactService } from "../bird/bird-contact.service";
import { UsersService } from "../users/users.service";

@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name);

  constructor(
    @InjectModel(Ticket.name)
    private readonly ticketModel: Model<TicketDocument>,
    private readonly birdEmailService: BirdEmailService,
    private readonly birdContactService: BirdContactService,
    private readonly usersService: UsersService,
  ) {}

  async createTicket(
    dto: CreateTicketDto,
    actor?: { userId?: string; name?: string; email?: string },
    clientIp?: string,
  ): Promise<TicketDocument> {
    const ticketNumber = await generateTicketNumber(this.ticketModel);
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
      this.birdContactService,
      {
        name: customerName,
        email: customerEmail,
        phone: dto.customerPhone,
        userId: actor?.userId,
      },
      this.logger,
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

    const ticket = new this.ticketModel({
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
    void sendTicketCreationEmail(this.birdEmailService, saved, this.logger);
    return saved;
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
    if (actor.isAgent && !isInternal) {
      void sendTicketReplyEmail(
        this.birdEmailService,
        ticket,
        dto.content,
        actor.name,
        this.logger,
      );
    }
    return ticket.save();
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
    const filter = buildTicketFilter(query);
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    const [tickets, total] = await Promise.all([
      this.ticketModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.ticketModel.countDocuments(filter).exec(),
    ]);

    tickets.forEach((t) => {
      t.sla.isSlaBreached = evaluateSlaBreach(t.sla, t.status);
    });
    return { tickets, total, page, limit };
  }

  async findById(
    ticketId: string,
    isStaffOrAdmin: boolean,
  ): Promise<TicketDocument> {
    const ticket = await this.ticketModel.findById(ticketId).exec();
    if (!ticket) throw new NotFoundException("Ticket no encontrado");
    ticket.sla.isSlaBreached = evaluateSlaBreach(ticket.sla, ticket.status);
    if (!isStaffOrAdmin) {
      ticket.messages = ticket.messages.filter((m) => !m.isInternalNote);
    }
    return ticket;
  }

  async findForUser(userId: string): Promise<TicketDocument[]> {
    const tickets = await this.ticketModel
      .find({ "customer.userId": userId })
      .sort({ createdAt: -1 })
      .exec();
    tickets.forEach((t) => {
      t.sla.isSlaBreached = evaluateSlaBreach(t.sla, t.status);
      t.messages = t.messages.filter((m) => !m.isInternalNote);
    });
    return tickets;
  }

  async getStats(): Promise<Record<string, unknown>> {
    const [total, byStatus, byPriority, byChannel] = await Promise.all([
      this.ticketModel.countDocuments().exec(),
      this.ticketModel.aggregate<{ _id: string; count: number }>([
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      this.ticketModel.aggregate<{ _id: string; count: number }>([
        { $group: { _id: "$priority", count: { $sum: 1 } } },
      ]),
      this.ticketModel.aggregate<{ _id: string; count: number }>([
        { $group: { _id: "$channel", count: { $sum: 1 } } },
      ]),
    ]);

    const statusCounts: Record<string, number> = {};
    for (const s of byStatus) {
      statusCounts[s._id] = s.count;
    }
    return { total, byStatus: statusCounts, byPriority, byChannel };
  }

  async deleteTicket(ticketId: string): Promise<{ deleted: boolean }> {
    const res = await this.ticketModel.findByIdAndDelete(ticketId).exec();
    if (!res) throw new NotFoundException("Ticket no encontrado");
    return { deleted: true };
  }
}
