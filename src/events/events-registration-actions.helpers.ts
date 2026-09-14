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

  if (existing) {
    return updateCancelledRegistration(
      eventModel,
      existing,
      dto,
      status,
      membershipStatus,
      userId,
      event,
      logger,
    );
  }

  return createNewRegistration(
    eventModel,
    eventRegistrationModel,
    userId,
    dto,
    status,
    membershipStatus,
    event,
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
    throw new BadRequestException("El registro ya está confirmado");
  }

  validateConfirmationPrerequisites(registration);

  if (registration.status === "CANCELLED") {
    const event = await eventModel.findOne({ slug: eventSlug });
    if (event) {
      try {
        await incrementEventRegisteredCount(eventModel, eventSlug, event);
      } catch {
        throw new BadRequestException(
          "El evento ha alcanzado su capacidad máxima",
        );
      }
    }
  }

  registration.status = "CONFIRMED";
  registration.confirmedAt = new Date();
  const saved = await registration.save();
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
