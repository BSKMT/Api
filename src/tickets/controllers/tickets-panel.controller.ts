import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  ForbiddenException,
} from "@nestjs/common";
import type { Request } from "express";
import { SessionGuard } from "../../auth/session.guard";
import { TicketsService } from "../tickets.service";
import { CreateTicketDto } from "../dto/create-ticket.dto";
import { CreateMemberTicketDto } from "../dto/create-member-ticket.dto";
import { TicketReplyDto } from "../dto/ticket-reply.dto";
import {
  TicketChannel,
  TicketPriority,
  type TicketDocument,
} from "../schemas/ticket.schema";
import { ParseObjectIdPipe } from "../../common/pipes/parse-object-id.pipe";
import { UsersService } from "../../users/users.service";
import {
  extractUserName,
  extractUserPhone,
} from "../helpers/ticket-actions.helper";

interface AuthenticatedMemberRequest extends Request {
  user: { userId: string; email: string };
}

function isTicketOwner(
  ticket: TicketDocument,
  user: { userId: string; email: string },
): boolean {
  // M-10: When customer.userId is bound, require exact userId match (prevents email-reuse IDOR).
  if (ticket.customer.userId) {
    return ticket.customer.userId === user.userId;
  }
  return (
    Boolean(ticket.customer.email) &&
    ticket.customer.email.toLowerCase() === user.email.toLowerCase()
  );
}

@Controller("panel/support")
@UseGuards(SessionGuard)
export class TicketsPanelController {
  constructor(
    private readonly ticketsService: TicketsService,
    private readonly usersService: UsersService,
  ) {}

  @Get()
  async getMyTickets(@Req() req: AuthenticatedMemberRequest) {
    return this.ticketsService.findForUser(req.user.userId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createMyTicket(
    @Body() memberDto: CreateMemberTicketDto,
    @Req() req: AuthenticatedMemberRequest,
  ) {
    const fullUser = await this.usersService.findById(req.user.userId);
    const actor = {
      userId: req.user.userId,
      name: extractUserName(fullUser, req.user.email),
      email: req.user.email,
    };
    const phone = extractUserPhone(fullUser);
    // H-08: Construct authoritative DTO server-side; ignore client priority/phone/tags/channel.
    const dto: CreateTicketDto = {
      subject: memberDto.subject,
      description: memberDto.description,
      category: memberDto.category,
      priority: TicketPriority.MEDIA,
      channel: TicketChannel.PANEL,
      customerName: actor.name,
      customerEmail: actor.email,
      customerPhone: phone ?? undefined,
      tags: [],
    };
    const created = await this.ticketsService.createTicket(dto, actor);
    return this.ticketsService.findById(String(created._id), false);
  }

  @Get(":id")
  async getMyTicket(
    @Param("id", ParseObjectIdPipe) id: string,
    @Req() req: AuthenticatedMemberRequest,
  ) {
    const ticket = await this.ticketsService.findById(id, false);
    if (!isTicketOwner(ticket, req.user)) {
      throw new ForbiddenException(
        "No tienes autorización para ver este ticket",
      );
    }
    return ticket;
  }

  @Post(":id/reply")
  async replyMyTicket(
    @Param("id", ParseObjectIdPipe) id: string,
    @Body() dto: TicketReplyDto,
    @Req() req: AuthenticatedMemberRequest,
  ) {
    const ticket = await this.ticketsService.findById(id, false);
    if (!isTicketOwner(ticket, req.user)) {
      throw new ForbiddenException(
        "No tienes autorización para responder a este ticket",
      );
    }
    const fullUser = await this.usersService.findById(req.user.userId);
    const actor = {
      userId: req.user.userId,
      name: extractUserName(fullUser, req.user.email),
      email: req.user.email,
      isAgent: false,
    };
    dto.isInternalNote = false;
    dto.sendEmail = false;
    dto.sendSms = false;
    dto.sendWhatsapp = false;
    await this.ticketsService.replyTicket(id, dto, actor);
    return this.ticketsService.findById(id, false);
  }
}
