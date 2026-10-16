import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Param,
  Query,
  Body,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import type { Request } from "express";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { SessionGuard } from "../../auth/session.guard";
import { GestionGuard } from "../../common/guards/gestion.guard";
import { RequireSubroles } from "../../common/decorators/subroles.decorator";
import {
  User,
  UserDocument,
  UserSubrole,
} from "../../users/schemas/user.schema";
import { Event, EventDocument } from "../../events/schemas/event.schema";
import {
  EventRegistration,
  EventRegistrationDocument,
} from "../../events/schemas/event-registration.schema";
import { ParseObjectIdPipe } from "../../common/pipes/parse-object-id.pipe";
import { buildCheckInOrClauses } from "../services/gestion-checkin.helpers";
import {
  fetchEnrichedEventRegistrations,
  validateEventCheckInPrerequisites,
  applyEventCheckIn,
  authorizeEventCoordinator,
} from "../services/gestion-eventos.helpers";
import { processEventScanCheckIn } from "../services/gestion-eventos-scan.helpers";
import type { GestionActor } from "../services/gestion-cursos.helpers";

interface AuthenticatedGestionRequest extends Request {
  user: GestionActor;
}

@Controller("gestion/eventos")
@UseGuards(SessionGuard, GestionGuard)
@RequireSubroles(
  UserSubrole.LIDER_EVENTOS,
  UserSubrole.GESTOR_EVENTOS,
  UserSubrole.GESTOR_CAMPO,
)
export class GestionEventosController {
  constructor(
    @InjectModel(Event.name)
    private readonly eventModel: Model<EventDocument>,
    @InjectModel(EventRegistration.name)
    private readonly registrationModel: Model<EventRegistrationDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {}

  @Get("events")
  async listEvents() {
    const events = await this.eventModel
      .find()
      .select(
        "_id slug title date endDate location meetingPoint meetingTime departureTime registeredCount maxCapacity coordinatorId coordinatorName coordinatorEmail status",
      )
      .sort({ date: -1 })
      .limit(50)
      .lean();
    return { events };
  }

  @Get("registrations/:eventId")
  async listRegistrations(
    @Param("eventId", ParseObjectIdPipe) eventId: string,
    @Query("search") search?: string,
  ) {
    return fetchEnrichedEventRegistrations(
      eventId,
      search,
      this.eventModel,
      this.registrationModel,
      this.userModel,
    );
  }

  @Post("scan-checkin")
  @HttpCode(HttpStatus.OK)
  async scanCheckIn(
    @Req() req: AuthenticatedGestionRequest,
    @Body() dto: { eventId?: string; codeOrQr: string },
  ) {
    const orClauses = buildCheckInOrClauses(dto.codeOrQr);
    const reg = await this.registrationModel.findOne({ $or: orClauses });
    if (!reg) {
      throw new NotFoundException(
        "No se encontró ninguna inscripción con este código o QR.",
      );
    }

    const rawReg = reg as unknown as Record<string, unknown>;
    const eventFilter = rawReg.eventId
      ? { $or: [{ _id: rawReg.eventId }, { slug: reg.eventSlug }] }
      : { slug: reg.eventSlug };
    const event = await this.eventModel.findOne(eventFilter);
    if (!event) {
      throw new NotFoundException(
        "El evento asociado a esta inscripción no fue encontrado.",
      );
    }

    if (dto.eventId && String(event._id) !== String(dto.eventId)) {
      throw new BadRequestException(
        `Este ticket pertenece al evento "${event.title}", no al evento seleccionado.`,
      );
    }

    authorizeEventCoordinator(event, req.user);
    validateEventCheckInPrerequisites(event, reg);

    const userDoc = await this.userModel
      .findById(reg.userId)
      .select("email profile contractorInfo")
      .lean();

    return processEventScanCheckIn(reg, userDoc, req.user);
  }

  @Post("check-in/:id")
  @Put("check-in/:id")
  @Patch("check-in/:id")
  @HttpCode(HttpStatus.OK)
  async checkIn(
    @Param("id", ParseObjectIdPipe) id: string,
    @Req() req: AuthenticatedGestionRequest,
  ) {
    const reg = await this.registrationModel.findById(id);
    if (!reg) {
      throw new NotFoundException("Inscripción no encontrada");
    }

    const rawReg = reg as unknown as Record<string, unknown>;
    const eventFilter = rawReg.eventId
      ? { $or: [{ _id: rawReg.eventId }, { slug: reg.eventSlug }] }
      : { slug: reg.eventSlug };
    const event = await this.eventModel.findOne(eventFilter);
    if (!event) {
      throw new NotFoundException("Evento asociado no encontrado");
    }

    authorizeEventCoordinator(event, req.user);
    validateEventCheckInPrerequisites(event, reg);
    await applyEventCheckIn(reg, req.user);

    return {
      success: true,
      message: "Piloto registrado y asistencia confirmada en campo.",
      registration: reg,
    };
  }
}
