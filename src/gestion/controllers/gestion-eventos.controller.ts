import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, isValidObjectId } from "mongoose";
import { SessionGuard } from "../../auth/session.guard";
import { GestionGuard } from "../../common/guards/gestion.guard";
import { RequireSubroles } from "../../common/decorators/subroles.decorator";
import { UserSubrole } from "../../users/schemas/user.schema";
import { Event, EventDocument } from "../../events/schemas/event.schema";
import {
  EventRegistration,
  EventRegistrationDocument,
} from "../../events/schemas/event-registration.schema";

@Controller("gestion/eventos")
@UseGuards(SessionGuard, GestionGuard)
@RequireSubroles(UserSubrole.LIDER_EVENTOS, UserSubrole.GESTOR_EVENTOS)
export class GestionEventosController {
  constructor(
    @InjectModel(Event.name)
    private readonly eventModel: Model<EventDocument>,
    @InjectModel(EventRegistration.name)
    private readonly registrationModel: Model<EventRegistrationDocument>,
  ) {}

  @Get("events")
  async listEvents() {
    const events = await this.eventModel
      .find()
      .sort({ date: -1 })
      .limit(50)
      .lean();
    return { events };
  }

  @Get("registrations/:eventId")
  async listRegistrations(
    @Param("eventId") eventId: string,
    @Query("search") search?: string,
  ) {
    const event = await this.eventModel.findById(eventId).lean();
    if (!event) {
      throw new NotFoundException("Evento no encontrado");
    }

    const filter: Record<string, unknown> = {
      $or: [{ eventId }, { eventSlug: event.slug }],
    };

    if (search) {
      const searchRegex = new RegExp(
        search.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`),
        "i",
      );
      filter.$and = [
        {
          $or: [
            { userEmail: searchRegex },
            { userName: searchRegex },
            { "companionData.fullName": searchRegex },
          ],
        },
      ];
    }

    const registrations = await this.registrationModel
      .find(filter)
      .sort({ createdAt: -1 })
      .lean();

    return {
      event: {
        _id: event._id,
        title: event.title,
        date: event.date,
        registeredCount: event.registeredCount,
        maxCapacity: event.maxCapacity,
      },
      registrations,
    };
  }

  @Post("check-in/:id")
  @HttpCode(HttpStatus.OK)
  async checkIn(@Param("id") id: string) {
    if (!isValidObjectId(id)) {
      throw new BadRequestException("Identificador de inscripción inválido");
    }

    const reg = await this.registrationModel.findById(id);
    if (!reg) {
      throw new NotFoundException("Inscripción no encontrada");
    }

    // F-09: Validar exoneración de responsabilidad (waiver) antes del check-in
    if (!reg.waiverAccepted) {
      throw new BadRequestException(
        "No se puede realizar check-in: el participante no ha aceptado la exoneración de responsabilidad (waiver).",
      );
    }

    // F-09: Validar confirmación de pago si la inscripción requería pago
    const rawReg = reg as unknown as Record<string, unknown>;
    const eventFilter = rawReg.eventId
      ? { $or: [{ _id: rawReg.eventId }, { slug: reg.eventSlug }] }
      : { slug: reg.eventSlug };
    const event = await this.eventModel.findOne(eventFilter);

    const isPaidEvent =
      event &&
      ((!event.membersFree && reg.membershipStatus === "member") ||
        reg.membershipStatus !== "member" ||
        reg.registrationType === "with-companion");

    if (isPaidEvent && !reg.paymentConfirmed) {
      throw new BadRequestException(
        "No se puede realizar check-in: el pago de la inscripción no ha sido confirmado.",
      );
    }

    reg.status = "CONFIRMED";
    await reg.save();

    return {
      success: true,
      message: "Piloto registrado en punto de encuentro",
      registration: reg,
    };
  }
}
