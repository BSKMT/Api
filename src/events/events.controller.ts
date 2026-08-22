import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  Req,
  Headers,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import { SessionGuard } from "../auth/session.guard";
import { Public } from "../common/decorators";
import { IdentityVerifiedGuard } from "../common/guards";
import { UsersService } from "../users/users.service";
import { EventsService, MEMBER_LEVELS } from "./events.service";
import { RegisterEventDto } from "./dto/register-event.dto";
import { AcceptWaiverDto } from "./dto/accept-waiver.dto";
import { SubmitCompanionDto } from "./dto/submit-companion.dto";
import { ConfirmEventDto } from "./dto/confirm-event.dto";
import { CancelEventDto } from "./dto/cancel-event.dto";
import type { EnvironmentConfig } from "../config/config.interface";

interface AuthenticatedRequest extends Request {
  user: { userId: string; email?: string };
}

@Controller("events")
@UseGuards(SessionGuard)
export class EventsController {
  private readonly logger = new Logger(EventsController.name);

  constructor(
    private readonly eventsService: EventsService,
    private readonly usersService: UsersService,
    private readonly configService: ConfigService<EnvironmentConfig>,
  ) {}

  @Public()
  @Throttle({ long: { ttl: 60000, limit: 30 } })
  @Get("upcoming")
  async getUpcomingEvents(@Query("limit") limit?: string) {
    // M-2: Clamp pagination to prevent DoS via massive limit values
    const raw = limit ? Number.parseInt(limit, 10) : 6;
    const parsedLimit = Math.min(
      Math.max(Number.isFinite(raw) ? raw : 6, 1),
      100,
    );
    return this.eventsService.getUpcomingEvents(parsedLimit);
  }

  @Public()
  @Throttle({ long: { ttl: 60000, limit: 30 } })
  @Get("featured")
  async getFeaturedEvents(@Query("limit") limit?: string) {
    const raw = limit ? Number.parseInt(limit, 10) : 3;
    const parsedLimit = Math.min(
      Math.max(Number.isFinite(raw) ? raw : 3, 1),
      100,
    );
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

  /**
   * A-KYC: event registration requires a verified identity
   * (OWASP A01 — server-side enforcement).
   */
  @UseGuards(IdentityVerifiedGuard)
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
    return this.eventsService.acceptWaiver(userId, dto.eventSlug, req.ip);
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

  /**
   * M-5: Cron-triggered sweeper that releases seats held by abandoned
   * PENDING event registrations and course enrollments (older than
   * 48h, no paymentConfirmed and no transactionReference). Invoked by
   * Vercel Cron (see `vercel.json`). Authenticated via
   * `X-Cron-Secret` header or `Authorization: Bearer <secret>`.
   */
  @Public()
  @Post("internal/cron/sweep-stale-registrations")
  @HttpCode(HttpStatus.OK)
  async sweepStaleRegistrations(
    @Headers("x-cron-secret") headerSecret: string | undefined,
    @Headers("authorization") authorization: string | undefined,
  ) {
    this.assertCronSecret(headerSecret, authorization);
    const startedAt = Date.now();
    const result = await this.eventsService.sweepStaleRegistrations();
    const elapsed = Date.now() - startedAt;
    this.logger.log(
      `sweep-stale-registrations cron completed in ${elapsed}ms — ${result.eventsCancelled} events, ${result.coursesCancelled} courses`,
    );
    return { ok: true, ...result, elapsedMs: elapsed };
  }

  private assertCronSecret(
    headerSecret: string | undefined,
    authorization: string | undefined,
  ): void {
    const expected =
      this.configService.get<string>("CRON_SECRET", { infer: true }) ?? "";
    if (!expected) {
      throw new BadRequestException("CRON_SECRET not configured");
    }
    const provided =
      headerSecret ??
      (authorization?.startsWith("Bearer ")
        ? authorization.slice("Bearer ".length)
        : undefined) ??
      "";
    if (provided.length !== expected.length || provided !== expected) {
      this.logger.warn(
        "Unauthorized cron invocation — secret mismatch (or missing).",
      );
      throw new BadRequestException("Invalid or missing cron secret");
    }
  }
}
