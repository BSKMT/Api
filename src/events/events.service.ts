import {
  Injectable,
  Logger,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import {
  EventRegistration,
  EventRegistrationDocument,
} from "./schemas/event-registration.schema";
import { RegisterEventDto } from "./dto/register-event.dto";
import { SubmitCompanionDto } from "./dto/submit-companion.dto";

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    @InjectModel(EventRegistration.name)
    private eventRegistrationModel: Model<EventRegistrationDocument>,
  ) {}

  async registerForEvent(
    userId: string,
    dto: RegisterEventDto,
    membershipLevel: string | null,
  ): Promise<EventRegistrationDocument> {
    const existing = await this.eventRegistrationModel.findOne({
      userId,
      eventSlug: dto.eventSlug,
    });

    if (existing) {
      throw new ConflictException("Ya estás registrado para este evento");
    }

    let membershipStatus: string;

    if (
      membershipLevel === "Legend" &&
      dto.registrationType === "professional"
    ) {
      membershipStatus = "active-member";
    } else if (
      dto.registrationType === "professional" &&
      membershipLevel !== "Legend"
    ) {
      membershipStatus = "non-member-paid";
    } else {
      membershipStatus = "non-member-free";
    }

    let status = "PENDING";

    if (membershipStatus === "active-member" && dto.attendanceMode === "solo") {
      status = "CONFIRMED";
    }

    const registration = new this.eventRegistrationModel({
      userId,
      eventSlug: dto.eventSlug,
      registrationType: dto.registrationType,
      attendanceMode: dto.attendanceMode,
      status,
      membershipStatus,
      confirmedAt: status === "CONFIRMED" ? new Date() : null,
    });

    const saved = await registration.save();
    this.logger.log(
      `Event registration: user=${userId} event=${dto.eventSlug} status=${status}`,
    );
    return saved;
  }

  async confirmRegistration(
    userId: string,
    eventSlug: string,
  ): Promise<EventRegistrationDocument> {
    const registration = await this.eventRegistrationModel.findOne({
      userId,
      eventSlug,
    });

    if (!registration) {
      throw new NotFoundException("Registro no encontrado");
    }

    if (registration.status === "CONFIRMED") {
      throw new BadRequestException("El registro ya está confirmado");
    }

    const { membershipStatus, attendanceMode } = registration;

    if (membershipStatus === "active-member" && attendanceMode === "solo") {
      // no prerequisites
    } else if (
      membershipStatus === "active-member" &&
      attendanceMode === "with-companion"
    ) {
      if (!registration.paymentConfirmed) {
        throw new BadRequestException("Pago del acompañante pendiente");
      }
      if (!registration.companionData) {
        throw new BadRequestException("Datos del acompañante requeridos");
      }
    } else if (membershipStatus === "non-member-paid") {
      if (!registration.paymentConfirmed) {
        throw new BadRequestException("Pago pendiente");
      }
      if (attendanceMode === "with-companion" && !registration.companionData) {
        throw new BadRequestException("Datos del acompañante requeridos");
      }
    } else if (
      membershipStatus === "non-member-free" &&
      attendanceMode === "solo"
    ) {
      if (!registration.waiverAccepted) {
        throw new BadRequestException(
          "Debes aceptar la exoneración de responsabilidad",
        );
      }
    } else if (
      membershipStatus === "non-member-free" &&
      attendanceMode === "with-companion"
    ) {
      if (!registration.waiverAccepted) {
        throw new BadRequestException(
          "Debes aceptar la exoneración de responsabilidad",
        );
      }
      if (!registration.companionData) {
        throw new BadRequestException("Datos del acompañante requeridos");
      }
    }

    registration.status = "CONFIRMED";
    registration.confirmedAt = new Date();
    const saved = await registration.save();
    this.logger.log(
      `Registration confirmed: user=${userId} event=${eventSlug}`,
    );
    return saved;
  }

  async acceptWaiver(
    userId: string,
    eventSlug: string,
  ): Promise<EventRegistrationDocument> {
    const registration = await this.eventRegistrationModel.findOneAndUpdate(
      { userId, eventSlug },
      { waiverAccepted: true, waiverAcceptedAt: new Date() },
      { new: true },
    );

    if (!registration) {
      throw new NotFoundException("Registro no encontrado");
    }

    this.logger.log(`Waiver accepted: user=${userId} event=${eventSlug}`);
    return registration;
  }

  async submitCompanionData(
    userId: string,
    eventSlug: string,
    dto: SubmitCompanionDto,
  ): Promise<EventRegistrationDocument> {
    const registration = await this.eventRegistrationModel.findOneAndUpdate(
      { userId, eventSlug },
      { companionData: dto },
      { new: true },
    );

    if (!registration) {
      throw new NotFoundException("Registro no encontrado");
    }

    this.logger.log(
      `Companion data submitted: user=${userId} event=${eventSlug}`,
    );
    return registration;
  }

  async linkPayment(
    userId: string,
    eventSlug: string,
    transactionReference: string,
  ): Promise<EventRegistrationDocument> {
    const registration = await this.eventRegistrationModel.findOneAndUpdate(
      { userId, eventSlug },
      { transactionReference, paymentConfirmed: true },
      { new: true },
    );

    if (!registration) {
      throw new NotFoundException("Registro no encontrado");
    }

    this.logger.log(
      `Payment linked: user=${userId} event=${eventSlug} ref=${transactionReference}`,
    );
    return registration;
  }

  async getRegistration(
    userId: string,
    eventSlug: string,
  ): Promise<EventRegistrationDocument | null> {
    return this.eventRegistrationModel.findOne({ userId, eventSlug });
  }

  async getRegistrationsByUser(
    userId: string,
  ): Promise<EventRegistrationDocument[]> {
    return this.eventRegistrationModel.find({ userId }).sort({ createdAt: -1 });
  }
}
