import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from "@nestjs/common";
import type { Request } from "express";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { Public } from "../common/decorators";
import { UsersService } from "../users/users.service";
import { EventsService } from "./events.service";
import { RegisterEventDto } from "./dto/register-event.dto";
import { AcceptWaiverDto } from "./dto/accept-waiver.dto";
import { SubmitCompanionDto } from "./dto/submit-companion.dto";

@Controller("events")
@UseGuards(JwtAuthGuard)
export class EventsController {
  constructor(
    private readonly eventsService: EventsService,
    private readonly usersService: UsersService,
  ) {}

  @Public()
  @Get("upcoming")
  async getUpcomingEvents(@Query("limit") limit?: string) {
    const parsedLimit = limit ? parseInt(limit, 10) : 6;
    return this.eventsService.getUpcomingEvents(parsedLimit);
  }

  @Public()
  @Get("featured")
  async getFeaturedEvents(@Query("limit") limit?: string) {
    const parsedLimit = limit ? parseInt(limit, 10) : 3;
    return this.eventsService.getFeaturedEvents(parsedLimit);
  }

  @Public()
  @Get("stats")
  async getEventStats() {
    return this.eventsService.getEventStats();
  }

  @Public()
  @Get("detail/:slug")
  async getEventBySlug(@Param("slug") slug: string) {
    const event = await this.eventsService.getEventBySlug(slug);
    if (!event) {
      throw new BadRequestException("Evento no encontrado");
    }
    return event;
  }

  @Post("register")
  @HttpCode(HttpStatus.CREATED)
  async registerForEvent(@Req() req: Request, @Body() dto: RegisterEventDto) {
    const user = req.user as { userId: string };
    const fullUser = await this.usersService.findById(user.userId);
    const membershipLevel = fullUser?.membershipLevel ?? null;
    const registration = await this.eventsService.registerForEvent(
      user.userId,
      dto,
      membershipLevel,
    );
    return registration;
  }

  @Post("confirm")
  async confirmRegistration(
    @Req() req: Request,
    @Body("eventSlug") eventSlug: string,
  ) {
    const user = req.user as { userId: string };
    return this.eventsService.confirmRegistration(user.userId, eventSlug);
  }

  @Post("waiver")
  async acceptWaiver(
    @Req() req: Request,
    @Body("eventSlug") eventSlug: string,
    @Body() dto: AcceptWaiverDto,
  ) {
    if (!dto.waiverAccepted) {
      throw new BadRequestException(
        "Debes aceptar la exoneración de responsabilidad",
      );
    }
    const user = req.user as { userId: string };
    return this.eventsService.acceptWaiver(user.userId, eventSlug);
  }

  @Post("companion")
  async submitCompanion(
    @Req() req: Request,
    @Body("eventSlug") eventSlug: string,
    @Body() dto: SubmitCompanionDto,
  ) {
    const user = req.user as { userId: string };
    return this.eventsService.submitCompanionData(user.userId, eventSlug, dto);
  }

  @Get("registration/:eventSlug")
  async getRegistration(
    @Req() req: Request,
    @Param("eventSlug") eventSlug: string,
  ) {
    const user = req.user as { userId: string };
    return this.eventsService.getRegistration(user.userId, eventSlug);
  }

  @Get("my-registrations")
  async getMyRegistrations(@Req() req: Request) {
    const user = req.user as { userId: string };
    return this.eventsService.getRegistrationsByUser(user.userId);
  }
}
