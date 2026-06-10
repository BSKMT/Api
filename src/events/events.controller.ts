import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import type { Request } from "express";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
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

  @Post("register")
  @HttpCode(HttpStatus.CREATED)
  async registerForEvent(
    @Req() req: Request,
    @Body() dto: RegisterEventDto,
  ) {
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
    return this.eventsService.submitCompanionData(
      user.userId,
      eventSlug,
      dto,
    );
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
