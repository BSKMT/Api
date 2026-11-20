import {
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Model } from "mongoose";
import type { EventDocument } from "./schemas/event.schema";
import type { EventRegistrationDocument } from "./schemas/event-registration.schema";
import type { RegisterEventDto } from "./dto/register-event.dto";
import type { SubmitCompanionDto } from "./dto/submit-companion.dto";
import { MEMBER_LEVELS } from "./events.constants";
import {
  validateEventForRegistration,
  determineMembershipStatus,
  determineInitialStatus,
  updateCancelledRegistration,
  createNewRegistration,
  validateConfirmationPrerequisites,
  incrementEventRegisteredCount,
} from "./events-registration.helpers";

export async function executeRegisterForEvent(
  eventModel: Model<EventDocument>,
  eventRegistrationModel: Model<EventRegistrationDocument>,
  userId: string,
  dto: RegisterEventDto,
  membershipLevel: string | null,
  logger: Logger,
): Promise<EventRegistrationDocument> {
  const event = await validateEventForRegistration(eventModel, dto.eventSlug);
  const existing = await eventRegistrationModel.findOne({
    userId,
    eventSlug: dto.eventSlug,
  });
  if (existing && existing.status !== "CANCELLED") {
    throw new ConflictException("Ya estás registrado para este evento");
  }

  const isMember = MEMBER_LEVELS.has(membershipLevel ?? "");
  const membershipStatus = determineMembershipStatus(isMember, dto, event);
  const status = determineInitialStatus(membershipStatus, dto);

  const registrationState = {
    dto,
    status,
    membershipStatus,
    userId,
    event,
  };

  if (existing) {
    return updateCancelledRegistration(
      eventModel,
      eventRegistrationModel,
      existing,
      registrationState,
      logger,
    );
  }

  return createNewRegistration(
    eventModel,
    eventRegistrationModel,
    registrationState,
    logger,
  );
}

export async function executeConfirmRegistration(
  eventModel: Model<EventDocument>,
  eventRegistrationModel: Model<EventRegistrationDocument>,
  userId: string,
  eventSlug: string,
  logger: Logger,
): Promise<EventRegistrationDocument> {
  const registration = await eventRegistrationModel.findOne({
    userId,
    eventSlug,
  });

  if (!registration) {
    throw new NotFoundException("Registro no encontrado");
  }

  if (registration.status === "CONFIRMED") {
    logger.log(
      `Registration already confirmed: user=${userId} event=${eventSlug}`,
    );
    return registration;
  }

  validateConfirmationPrerequisites(registration);

  // M-02: Verify event is published and has not ended before confirming registration.
  const event = await eventModel.findOne({ slug: eventSlug });
  if (!event) {
    throw new NotFoundException("Evento no encontrado");
  }
  const eventStatus = (event.status ?? "").toUpperCase();
  if (
    eventStatus === "CANCELLED" ||
    eventStatus === "COMPLETED" ||
    eventStatus === "DRAFT"
  ) {
    throw new BadRequestException(
      "Este evento ya no se encuentra disponible para confirmación.",
    );
  }
  const cutoffDate = event.endDate ?? event.date;
  if (cutoffDate && new Date(cutoffDate).getTime() < Date.now()) {
    throw new BadRequestException(
      "No se puede confirmar inscripción en un evento cuya fecha ya pasó.",
    );
  }

  const prevStatus = registration.status;
  if (prevStatus === "CANCELLED") {
    try {
      await incrementEventRegisteredCount(eventModel, eventSlug, event);
    } catch {
      throw new BadRequestException(
        "El evento ha alcanzado su capacidad máxima",
      );
    }
  }

  // Atomic transition to avoid double-confirmation / concurrent seat increment races.
  const saved = await eventRegistrationModel.findOneAndUpdate(
    { _id: registration._id, status: prevStatus },
    { $set: { status: "CONFIRMED", confirmedAt: new Date() } },
    { new: true },
  );
  if (!saved) {
    if (prevStatus === "CANCELLED") {
      await eventModel.updateOne(
        { slug: eventSlug, registeredCount: { $gt: 0 } },
        { $inc: { registeredCount: -1 } },
      );
    }
    const latest = await eventRegistrationModel.findById(registration._id);
    if (latest?.status === "CONFIRMED") {
      return latest;
    }
    throw new ConflictException(
      "El estado de la inscripción cambió concurrentemente. Intenta de nuevo.",
    );
  }

  logger.log(`Registration confirmed: user=${userId} event=${eventSlug}`);
  return saved;
}

export async function executeAcceptWaiver(
  eventRegistrationModel: Model<EventRegistrationDocument>,
  userId: string,
  eventSlug: string,
  clientIp?: string,
  logger?: Logger,
): Promise<EventRegistrationDocument> {
  const registration = await eventRegistrationModel.findOneAndUpdate(
    { userId, eventSlug },
    {
      waiverAccepted: true,
      waiverAcceptedAt: new Date(),
      waiverAcceptedIp: clientIp ?? null,
    },
    { new: true },
  );

  if (!registration) {
    throw new NotFoundException("Registro no encontrado");
  }

  logger?.log(`Waiver accepted: user=${userId} event=${eventSlug}`);
  return registration;
}

export async function executeSubmitCompanionData(
  eventRegistrationModel: Model<EventRegistrationDocument>,
  userId: string,
  eventSlug: string,
  dto: SubmitCompanionDto,
  logger: Logger,
): Promise<EventRegistrationDocument> {
  const existing = await eventRegistrationModel.findOne({
    userId,
    eventSlug,
  });
  if (!existing) {
    throw new NotFoundException("Registro no encontrado");
  }
  if (existing.status === "CONFIRMED" && existing.companionData) {
    throw new BadRequestException(
      "El acompañante ya fue registrado en una inscripción confirmada. Cancela y vuelve a inscribirte para cambiarlo.",
    );
  }

  const registration = await eventRegistrationModel.findOneAndUpdate(
    { userId, eventSlug },
    { companionData: dto },
    { new: true },
  );

  logger.log(`Companion data submitted: user=${userId} event=${eventSlug}`);
  return registration as EventRegistrationDocument;
}

export async function executeLinkPayment(
  eventModel: Model<EventDocument>,
  eventRegistrationModel: Model<EventRegistrationDocument>,
  userId: string,
  eventSlug: string,
  transactionReference: string,
  logger: Logger,
): Promise<EventRegistrationDocument> {
  const registration = await eventRegistrationModel.findOneAndUpdate(
    { userId, eventSlug },
    { transactionReference, paymentConfirmed: true },
    { new: true },
  );

  if (!registration) {
    throw new NotFoundException("Registro no encontrado");
  }

  logger.log(
    `Payment linked: user=${userId} event=${eventSlug} ref=${transactionReference}`,
  );

  try {
    await executeConfirmRegistration(
      eventModel,
      eventRegistrationModel,
      userId,
      eventSlug,
      logger,
    );
    logger.log(
      `Auto-confirmed after payment: user=${userId} event=${eventSlug}`,
    );
  } catch {
    logger.warn(
      `Auto-confirm skipped (prerequisites pending): user=${userId} event=${eventSlug}`,
    );
  }

  return registration;
}
