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
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import { SessionGuard } from "../auth/session.guard";
import { Public } from "../common/decorators";
import { UsersService } from "../users/users.service";
import { EventsService } from "./events.service";
import { MEMBER_LEVELS } from "./events.service";
import { RegisterEventDto } from "./dto/register-event.dto";
import { AcceptWaiverDto } from "./dto/accept-waiver.dto";
import { SubmitCompanionDto } from "./dto/submit-companion.dto";
import { ConfirmEventDto } from "./dto/confirm-event.dto";
import { CancelEventDto } from "./dto/cancel-event.dto";

interface AuthenticatedRequest extends Request {
  user: { userId: string; email?: string };
}

@Controller("events")
@UseGuards(SessionGuard)
export class EventsController {
  constructor(
    private readonly eventsService: EventsService,
    private readonly usersService: UsersService,
  ) {}

  @Public()
  @Throttle({ long: { ttl: 60000, limit: 30 } })
  @Get("upcoming")
  async getUpcomingEvents(@Query("limit") limit?: string) {
    const parsedLimit = limit ? Number.parseInt(limit, 10) : 6;
    return this.eventsService.getUpcomingEvents(parsedLimit);
  }

  @Public()
  @Throttle({ long: { ttl: 60000, limit: 30 } })
  @Get("featured")
  async getFeaturedEvents(@Query("limit") limit?: string) {
    const parsedLimit = limit ? Number.parseInt(limit, 10) : 3;
    return this.eventsService.getFeaturedEvents(parsedLimit);
  }

  @Public()
  @Throttle({ long: { ttl: 60000, limit: 20 } })
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
  async registerForEvent(
    @Req() req: AuthenticatedRequest,
    @Body() dto: RegisterEventDto,
  ) {
    const { userId } = req.user;
    const fullUser = await this.usersService.findById(userId);
    const membershipLevel = fullUser?.membershipLevel ?? null;
    const registration = await this.eventsService.registerForEvent(
      userId,
      dto,
      membershipLevel,
    );
    return registration;
  }

  @Post("confirm")
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async confirmRegistration(
    @Req() req: AuthenticatedRequest,
    @Body() dto: ConfirmEventDto,
  ) {
    const { userId } = req.user;
    return this.eventsService.confirmRegistration(userId, dto.eventSlug);
  }

  @Post("waiver")
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async acceptWaiver(
    @Req() req: AuthenticatedRequest,
    @Body() dto: AcceptWaiverDto,
  ) {
    if (!dto.waiverAccepted) {
      throw new BadRequestException(
        "Debes aceptar la exoneración de responsabilidad",
      );
    }
    const { userId } = req.user;
    return this.eventsService.acceptWaiver(userId, dto.eventSlug);
  }

  @Post("companion")
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async submitCompanion(
    @Req() req: AuthenticatedRequest,
    @Body() dto: SubmitCompanionDto,
  ) {
    const { userId } = req.user;
    return this.eventsService.submitCompanionData(userId, dto.eventSlug, dto);
  }

  @Get("registration/:eventSlug")
  async getRegistration(
    @Req() req: AuthenticatedRequest,
    @Param("eventSlug") eventSlug: string,
  ) {
    const { userId } = req.user;
    return this.eventsService.getRegistration(userId, eventSlug);
  }

  @Get("registration-status/:eventSlug")
  async getRegistrationWithPricing(
    @Req() req: AuthenticatedRequest,
    @Param("eventSlug") eventSlug: string,
  ) {
    const { userId } = req.user;
    const fullUser = await this.usersService.findById(userId);
    const membershipLevel = fullUser?.membershipLevel ?? null;
    const event = await this.eventsService.getEventBySlug(eventSlug);
    if (!event) {
      throw new BadRequestException("Evento no encontrado");
    }
    const registration = await this.eventsService.getRegistration(
      userId,
      eventSlug,
    );
    const basePrice = event.nonMemberPrice ?? 0;
    const companionPrice = event.companionPrice ?? Math.round(basePrice * 0.5);
const isMember = MEMBER_LEVELS.has(membershipLevel ?? "");
      return {
        event: {
          slug: event.slug,
          title: event.title,
          date: event.date,
          location: event.location,
          nonMemberPrice: basePrice,
          membersFree: event.membersFree,
          maxCapacity: event.maxCapacity,
          registeredCount: event.registeredCount,
        },
        pricing: {
          memberSolo: 0,
          memberCompanion: companionPrice,
          nonMemberSolo: basePrice,
          nonMemberCompanion: basePrice + companionPrice,
        },
        isLegend: membershipLevel === "Legend",
        isMember,
        registration,
      };
  }

  @Get("my-registrations")
  async getMyRegistrations(@Req() req: AuthenticatedRequest) {
    const { userId } = req.user;
    return this.eventsService.getRegistrationsByUser(userId);
  }

  @Post("cancel")
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async cancelRegistration(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CancelEventDto,
  ) {
    const { userId } = req.user;
    return this.eventsService.cancelRegistration(userId, dto.eventSlug);
  }
}
