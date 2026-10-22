import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import type { Request } from "express";
import { SessionGuard } from "../../auth/session.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles, Role } from "../../common/decorators/roles.decorator";
import { TicketsService } from "../tickets.service";
import { CreateTicketDto } from "../dto/create-ticket.dto";
import { TicketReplyDto } from "../dto/ticket-reply.dto";
import { TicketQueryDto } from "../dto/ticket-query.dto";
import {
  UpdateTicketStatusDto,
  UpdateTicketPriorityDto,
  AssignTicketDto,
} from "../dto/update-ticket.dto";
import { ParseObjectIdPipe } from "../../common/pipes/parse-object-id.pipe";

interface AuthenticatedAdminRequest extends Request {
  user: { userId: string; email: string; name?: string; role?: string };
}

@Controller("admin/support")
@UseGuards(SessionGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPERADMIN)
export class TicketsAdminController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Get("stats")
  getStats() {
    return this.ticketsService.getStats();
  }

  @Get()
  findAll(@Query() query: TicketQueryDto) {
    return this.ticketsService.findAll(query);
  }

  @Get(":id")
  findById(@Param("id", ParseObjectIdPipe) id: string) {
    return this.ticketsService.findById(id, true);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  createTicket(
    @Body() dto: CreateTicketDto,
    @Req() req: AuthenticatedAdminRequest,
  ) {
    const actor = {
      userId: req.user.userId,
      name: req.user.name || req.user.email,
      email: req.user.email,
    };
    return this.ticketsService.createTicket(dto, actor);
  }

  @Post(":id/reply")
  replyTicket(
    @Param("id", ParseObjectIdPipe) id: string,
    @Body() dto: TicketReplyDto,
    @Req() req: AuthenticatedAdminRequest,
  ) {
    const actor = {
      userId: req.user.userId,
      name: req.user.name || req.user.email,
      email: req.user.email,
      isAgent: true,
    };
    return this.ticketsService.replyTicket(id, dto, actor);
  }

  @Patch(":id/status")
  updateStatus(
    @Param("id", ParseObjectIdPipe) id: string,
    @Body() dto: UpdateTicketStatusDto,
    @Req() req: AuthenticatedAdminRequest,
  ) {
    const actorName = req.user.name || req.user.email;
    return this.ticketsService.updateStatus(id, dto.status, actorName);
  }

  @Patch(":id/priority")
  updatePriority(
    @Param("id", ParseObjectIdPipe) id: string,
    @Body() dto: UpdateTicketPriorityDto,
    @Req() req: AuthenticatedAdminRequest,
  ) {
    const actorName = req.user.name || req.user.email;
    return this.ticketsService.updatePriority(id, dto.priority, actorName);
  }

  @Patch(":id/assign")
  assignTicket(
    @Param("id", ParseObjectIdPipe) id: string,
    @Body() dto: AssignTicketDto,
    @Req() req: AuthenticatedAdminRequest,
  ) {
    const actorName = req.user.name || req.user.email;
    return this.ticketsService.assignTicket(
      id,
      dto.assignedToUserId,
      actorName,
    );
  }

  @Delete(":id")
  deleteTicket(@Param("id", ParseObjectIdPipe) id: string) {
    return this.ticketsService.deleteTicket(id);
  }
}
