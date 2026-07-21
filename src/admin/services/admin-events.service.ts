import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import {
  Event,
  EventDocument,
  EventStatus,
} from "../../events/schemas/event.schema";
import {
  EventRegistration,
  EventRegistrationDocument,
} from "../../events/schemas/event-registration.schema";
import { CreateEventDto } from "../dto/create-event.dto";
import { UpdateEventDto } from "../dto/update-event.dto";

@Injectable()
export class AdminEventsService {
  private readonly logger = new Logger(AdminEventsService.name);

  constructor(
    @InjectModel(Event.name)
    private readonly eventModel: Model<EventDocument>,
    @InjectModel(EventRegistration.name)
    private readonly registrationModel: Model<EventRegistrationDocument>,
  ) {}

  async listEvents(filters: {
    status?: string;
    category?: string;
    limit?: number;
    page?: number;
  }) {
    const filter: Record<string, unknown> = {};
    if (filters.status) filter.status = filters.status;
    if (filters.category) filter.category = filters.category;

    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 100);
    const page = filters.page ?? 1;
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.eventModel
        .find(filter)
        .sort({ date: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.eventModel.countDocuments(filter),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async getEvent(slug: string): Promise<EventDocument> {
    const event = await this.eventModel.findOne({ slug }).lean();
    if (!event) {
      throw new NotFoundException("Evento no encontrado");
    }
    return event;
  }

  async createEvent(dto: CreateEventDto): Promise<EventDocument> {
    const existing = await this.eventModel.findOne({ slug: dto.slug });
    if (existing) {
      throw new ConflictException("Ya existe un evento con ese slug");
    }

    const created = await this.eventModel.create({
      ...dto,
      date: new Date(dto.date),
      endDate: dto.endDate ? new Date(dto.endDate) : null,
      status: dto.status ?? EventStatus.DRAFT,
      registeredCount: 0,
    });

    this.logger.log(`Event created: slug=${dto.slug} by admin`);
    return created;
  }

  async updateEvent(slug: string, dto: UpdateEventDto): Promise<EventDocument> {
    const event = await this.eventModel.findOne({ slug });
    if (!event) {
      throw new NotFoundException("Evento no encontrado");
    }

    const update: Record<string, unknown> = { ...dto };
    // A-7: Defense-in-depth — never allow slug change on update
    delete update.slug;
    if (dto.date) update.date = new Date(dto.date);
    if (dto.endDate) update.endDate = new Date(dto.endDate);
    else if (dto.endDate === undefined) delete update.endDate;

    const updated = await this.eventModel.findOneAndUpdate(
      { slug },
      { $set: update },
      { new: true },
    );

    this.logger.log(`Event updated: slug=${slug}`);
    return updated as EventDocument;
  }

  async deleteEvent(slug: string): Promise<{ message: string }> {
    const registrationsCount = await this.registrationModel.countDocuments({
      eventSlug: slug,
    });
    if (registrationsCount > 0) {
      throw new BadRequestException(
        `No se puede eliminar: existen ${registrationsCount} registros asociados. Usa cancelar.`,
      );
    }

    const result = await this.eventModel.deleteOne({ slug });
    if (result.deletedCount === 0) {
      throw new NotFoundException("Evento no encontrado");
    }
    this.logger.log(`Event deleted: slug=${slug}`);
    return { message: "Evento eliminado exitosamente" };
  }

  async setStatus(slug: string, status: EventStatus): Promise<EventDocument> {
    const event = await this.eventModel.findOneAndUpdate(
      { slug },
      { $set: { status } },
      { new: true },
    );
    if (!event) {
      throw new NotFoundException("Evento no encontrado");
    }
    this.logger.log(`Event status set: slug=${slug} status=${status}`);
    return event;
  }

  async listRegistrations(
    eventSlug: string,
    filters: {
      status?: string;
    },
  ) {
    const event = await this.eventModel.findOne({ slug: eventSlug }).lean();
    if (!event) {
      throw new NotFoundException("Evento no encontrado");
    }

    const filter: Record<string, unknown> = { eventSlug };
    if (filters.status) filter.status = filters.status;

    const items = await this.registrationModel
      .find(filter)
      .sort({ createdAt: -1 })
      .lean();

    return {
      event: {
        slug: event.slug,
        title: event.title,
        date: event.date,
        registeredCount: event.registeredCount,
        maxCapacity: event.maxCapacity,
      },
      registrations: items,
    };
  }

  async adminConfirmRegistration(registrationId: string) {
    const registration = await this.registrationModel.findById(registrationId);
    if (!registration) {
      throw new NotFoundException("Registro no encontrado");
    }
    if (registration.status === "CONFIRMED") {
      throw new BadRequestException("El registro ya está confirmado");
    }

    // M19: If re-confirming a CANCELLED registration, re-increment the seat count
    if (registration.status === "CANCELLED") {
      const event = await this.eventModel.findOne({
        slug: registration.eventSlug,
      });
      if (event) {
        const maxCap = event.maxCapacity;
        if (maxCap != null && maxCap > 0) {
          const updateResult = await this.eventModel.findOneAndUpdate(
            {
              slug: registration.eventSlug,
              $expr: {
                $lt: [{ $ifNull: ["$registeredCount", 0] }, maxCap],
              },
            },
            { $inc: { registeredCount: 1 } },
            { new: true },
          );
          if (!updateResult) {
            throw new BadRequestException(
              "El evento ha alcanzado su capacidad máxima",
            );
          }
        } else {
          await this.eventModel.updateOne(
            { slug: registration.eventSlug },
            { $inc: { registeredCount: 1 } },
          );
        }
      }
    }

    registration.status = "CONFIRMED";
    registration.confirmedAt = new Date();
    await registration.save();
    this.logger.log(`Registration admin-confirmed: id=${registrationId}`);
    return registration;
  }

  async adminCancelRegistration(registrationId: string) {
    const registration = await this.registrationModel.findById(registrationId);
    if (!registration) {
      throw new NotFoundException("Registro no encontrado");
    }
    if (registration.status === "CANCELLED") {
      throw new BadRequestException("El registro ya está cancelado");
    }
    registration.status = "CANCELLED";
    registration.confirmedAt = null;
    await registration.save();

    // M3: Decrement registeredCount atomically
    await this.eventModel.findOneAndUpdate(
      { slug: registration.eventSlug, registeredCount: { $gt: 0 } },
      { $inc: { registeredCount: -1 } },
    );

    this.logger.log(`Registration admin-cancelled: id=${registrationId}`);
    return registration;
  }
}
