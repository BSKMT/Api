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
import { TicketReplyDto } from "../dto/ticket-reply.dto";
import { TicketChannel } from "../schemas/ticket.schema";
import { ParseObjectIdPipe } from "../../common/pipes/parse-object-id.pipe";
import { UsersService } from "../../users/users.service";
import {
  extractUserName,
  extractUserPhone,
} from "../helpers/ticket-actions.helper";

interface AuthenticatedMemberRequest extends Request {
  user: { userId: string; email: string };
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
    @Body() dto: CreateTicketDto,
    @Req() req: AuthenticatedMemberRequest,
  ) {
    const fullUser = await this.usersService.findById(req.user.userId);
    const actor = {
      userId: req.user.userId,
      name: extractUserName(fullUser, req.user.email),
      email: req.user.email,
    };
    dto.channel = TicketChannel.PANEL;
    dto.customerName = actor.name;
    dto.customerEmail = actor.email;
    const phone = extractUserPhone(fullUser);
    if (phone) {
      dto.customerPhone = phone;
    }
    return this.ticketsService.createTicket(dto, actor);
  }

  @Get(":id")
  async getMyTicket(
    @Param("id", ParseObjectIdPipe) id: string,
    @Req() req: AuthenticatedMemberRequest,
  ) {
    const ticket = await this.ticketsService.findById(id, false);
    if (
      ticket.customer.userId !== req.user.userId &&
      ticket.customer.email !== req.user.email
    ) {
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
    if (
      ticket.customer.userId !== req.user.userId &&
      ticket.customer.email !== req.user.email
    ) {
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
    return this.ticketsService.replyTicket(id, dto, actor);
  }
}
