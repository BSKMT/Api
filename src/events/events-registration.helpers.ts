import { BadRequestException, Logger, NotFoundException } from "@nestjs/common";
import { Model } from "mongoose";
import { type EventDocument, EventStatus } from "./schemas/event.schema";
import type { EventRegistrationDocument } from "./schemas/event-registration.schema";
import type { RegisterEventDto } from "./dto/register-event.dto";

export async function validateEventForRegistration(
  eventModel: Model<EventDocument>,
  eventSlug: string,
): Promise<EventDocument> {
  const event = await eventModel.findOne({ slug: eventSlug });
  if (!event) {
    throw new NotFoundException("Evento no encontrado");
  }
  if (event.status !== EventStatus.PUBLISHED) {
    throw new BadRequestException("El evento no está disponible para registro");
  }
  if (new Date(event.date) < new Date()) {
    throw new BadRequestException(
      "No puedes registrarte en un evento que ya ocurrió",
    );
  }
  return event;
}

export function determineMembershipStatus(
  isMember: boolean,
  dto: RegisterEventDto,
  event: EventDocument,
): string {
  if (isMember) {
    return event.membersFree ? "active-member" : "member-paid";
  }
  if (dto.registrationType === "managed") {
    return "non-member-paid";
  }
  return "non-member-free";
}

export function determineInitialStatus(
  membershipStatus: string,
  dto: RegisterEventDto,
): string {
  if (membershipStatus === "active-member" && dto.attendanceMode === "solo") {
    return "CONFIRMED";
  }
  return "PENDING";
}

export async function incrementEventRegisteredCount(
  eventModel: Model<EventDocument>,
  eventSlug: string,
  event: { maxCapacity?: number | null },
): Promise<void> {
  const maxCap = event.maxCapacity;

  if (maxCap != null && maxCap > 0) {
    const updateResult = await eventModel.findOneAndUpdate(
      {
        slug: eventSlug,
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
    await eventModel.updateOne(
      { slug: eventSlug },
      { $inc: { registeredCount: 1 } },
    );
  }
}

export async function updateCancelledRegistration(
  eventModel: Model<EventDocument>,
  existing: EventRegistrationDocument,
  dto: RegisterEventDto,
  status: string,
  membershipStatus: string,
  userId: string,
  event: EventDocument,
  logger: Logger,
): Promise<EventRegistrationDocument> {
  existing.registrationType = dto.registrationType;
  existing.attendanceMode = dto.attendanceMode;
  existing.status = status;
  existing.membershipStatus = membershipStatus;
  existing.confirmedAt = status === "CONFIRMED" ? new Date() : null;
  existing.paymentConfirmed = false;
  existing.waiverAccepted = false;
  existing.waiverAcceptedAt = null;
  existing.transactionReference = null;
  existing.companionData = null;
  await incrementEventRegisteredCount(eventModel, dto.eventSlug, event);
  const saved = await existing.save();
  logger.log(
    `Event re-registration after cancellation: user=${userId} event=${dto.eventSlug} status=${status}`,
  );
  return saved;
}

export async function createNewRegistration(
  eventModel: Model<EventDocument>,
  eventRegistrationModel: Model<EventRegistrationDocument>,
  userId: string,
  dto: RegisterEventDto,
  status: string,
  membershipStatus: string,
  event: EventDocument,
  logger: Logger,
): Promise<EventRegistrationDocument> {
  const registration = new eventRegistrationModel({
    userId,
    eventSlug: dto.eventSlug,
    registrationType: dto.registrationType,
    attendanceMode: dto.attendanceMode,
    status,
    membershipStatus,
    confirmedAt: status === "CONFIRMED" ? new Date() : null,
  });

  const saved = await registration.save();
  try {
    await incrementEventRegisteredCount(eventModel, dto.eventSlug, event);
  } catch (err) {
    await eventRegistrationModel.deleteOne({ _id: saved._id }).exec();
    throw err;
  }
  logger.log(
    `Event registration: user=${userId} event=${dto.eventSlug} status=${status}`,
  );
  return saved;
}

export function validateConfirmationPrerequisites(
  registration: EventRegistrationDocument,
): void {
  const { membershipStatus, attendanceMode } = registration;

  const isMemberPaidSolo =
    membershipStatus === "member-paid" && attendanceMode === "solo";
  const isMemberPaidWithCompanion =
    membershipStatus === "member-paid" && attendanceMode === "with-companion";
  const isMemberFreeSolo =
    membershipStatus === "active-member" && attendanceMode === "solo";
  const isMemberFreeWithCompanion =
    membershipStatus === "active-member" && attendanceMode === "with-companion";
  const isNonMemberPaid = membershipStatus === "non-member-paid";
  const isNonMemberFreeSolo =
    membershipStatus === "non-member-free" && attendanceMode === "solo";
  const isNonMemberFreeWithCompanion =
    membershipStatus === "non-member-free" &&
    attendanceMode === "with-companion";

  if (isMemberPaidSolo) {
    requirePayment(registration);
    requireWaiver(registration);
    return;
  }
  if (isMemberPaidWithCompanion) {
    requirePayment(registration);
    requireCompanionData(registration);
    requireWaiver(registration);
    return;
  }
  if (isMemberFreeSolo) {
    return;
  }
  if (isMemberFreeWithCompanion) {
    requirePayment(registration);
    requireCompanionData(registration);
    return;
  }
  if (isNonMemberPaid) {
    requirePayment(registration);
    if (attendanceMode === "with-companion") {
      requireCompanionData(registration);
    }
    return;
  }
  if (isNonMemberFreeSolo) {
    requireWaiver(registration);
    return;
  }
  if (isNonMemberFreeWithCompanion) {
    requireWaiver(registration);
    requireCompanionData(registration);
  }
}

function requirePayment(registration: EventRegistrationDocument): void {
  if (!registration.paymentConfirmed) {
    throw new BadRequestException(
      registration.membershipStatus === "active-member"
        ? "Pago del acompañante pendiente"
        : "Pago pendiente",
    );
  }
}

function requireCompanionData(registration: EventRegistrationDocument): void {
  if (!registration.companionData) {
    throw new BadRequestException("Datos del acompañante requeridos");
  }
}

function requireWaiver(registration: EventRegistrationDocument): void {
  if (!registration.waiverAccepted) {
    throw new BadRequestException(
      "Debes aceptar la exoneración de responsabilidad",
    );
  }
}
