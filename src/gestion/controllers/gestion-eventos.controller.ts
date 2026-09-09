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
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
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
      const searchRegex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
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
    const reg = await this.registrationModel.findById(id);
    if (!reg) {
      throw new NotFoundException("Inscripción no encontrada");
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
