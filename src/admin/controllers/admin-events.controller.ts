import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { SessionGuard } from "../../auth/session.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles, Role } from "../../common/decorators";
import { AdminEventsService } from "../services/admin-events.service";
import { CreateEventDto } from "../dto/create-event.dto";
import { UpdateEventDto } from "../dto/update-event.dto";
import { EventStatus } from "../../events/schemas/event.schema";

@Controller("admin/events")
@UseGuards(SessionGuard, RolesGuard)
@Roles(Role.ADMIN, Role.EVENT_MANAGER)
export class AdminEventsController {
  constructor(private readonly adminEventsService: AdminEventsService) {}

  @Get()
  async list(
    @Query("status") status?: string,
    @Query("category") category?: string,
    @Query("limit") limit?: string,
    @Query("page") page?: string,
  ) {
    return this.adminEventsService.listEvents({
      status,
      category,
      limit: limit ? parseInt(limit, 10) : 50,
      page: page ? parseInt(page, 10) : 1,
    });
  }

  @Get(":slug")
  async getOne(@Param("slug") slug: string) {
    return this.adminEventsService.getEvent(slug);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateEventDto) {
    return this.adminEventsService.createEvent(dto);
  }

  @Put(":slug")
  async update(@Param("slug") slug: string, @Body() dto: UpdateEventDto) {
    return this.adminEventsService.updateEvent(slug, dto);
  }

  @Delete(":slug")
  async remove(@Param("slug") slug: string) {
    return this.adminEventsService.deleteEvent(slug);
  }

  @Post(":slug/publish")
  @HttpCode(HttpStatus.OK)
  async publish(@Param("slug") slug: string) {
    return this.adminEventsService.setStatus(slug, EventStatus.PUBLISHED);
  }

  @Post(":slug/cancel")
  @HttpCode(HttpStatus.OK)
  async cancel(@Param("slug") slug: string) {
    return this.adminEventsService.setStatus(slug, EventStatus.CANCELLED);
  }

  @Post(":slug/complete")
  @HttpCode(HttpStatus.OK)
  async complete(@Param("slug") slug: string) {
    return this.adminEventsService.setStatus(slug, EventStatus.COMPLETED);
  }

  @Get(":slug/registrations")
  async listRegistrations(
    @Param("slug") slug: string,
    @Query("status") status?: string,
  ) {
    return this.adminEventsService.listRegistrations(slug, { status });
  }

  @Post("registrations/:id/confirm")
  @HttpCode(HttpStatus.OK)
  async confirmRegistration(@Param("id") id: string) {
    return this.adminEventsService.adminConfirmRegistration(id);
  }

  @Post("registrations/:id/cancel")
  @HttpCode(HttpStatus.OK)
  async cancelRegistration(@Param("id") id: string) {
    return this.adminEventsService.adminCancelRegistration(id);
  }
}
