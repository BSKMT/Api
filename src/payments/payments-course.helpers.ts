import * as crypto from "node:crypto";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { CreatePaymentDto } from "./dto/create-payment.dto";
import {
  COURSE_TIER_REFERENCE_PREFIX,
  MEMBER_TIERS,
} from "./payments.constants";
import {
  verifyActiveMember,
  buildBoldResponse,
} from "./payments-creation.helpers";
import type { EventCoursePaymentDeps } from "./payments-event-course.helpers";

export async function createCoursePaymentHelper(
  deps: EventCoursePaymentDeps,
  userId: string,
  dto: CreatePaymentDto,
) {
  if (MEMBER_TIERS.has(dto.tier)) {
    await verifyActiveMember(deps.usersService, userId);
  }

  await deps.assertNoPendingForPurpose(userId, "course", dto.eventSlug);

  const course = await deps.eventsService.getCourseBySlug(dto.eventSlug);
  if (!course) {
    throw new NotFoundException("Curso no encontrado");
  }

  const enrollment = await deps.eventsService.getEnrollmentByUserAndCourse(
    userId,
    dto.eventSlug,
  );
  if (!enrollment) {
    throw new BadRequestException(
      "Debes inscribirte en el curso antes de proceder al pago.",
    );
  }
  if (enrollment.paymentConfirmed) {
    throw new BadRequestException(
      "El curso ya se encuentra pagado y confirmado.",
    );
  }

  const fullUser = await deps.usersService.findById(userId);
  const membershipLevel = fullUser?.membershipLevel ?? null;
  const expectedPricing = deps.eventsService.calculateCoursePricing(
    course,
    membershipLevel,
  );

  if (dto.tier !== expectedPricing.tier) {
    throw new BadRequestException(
      `El tier de pago no coincide con el requerido para este curso (${expectedPricing.tier}).`,
    );
  }

  const basePrice = course.nonMemberPrice ?? null;
  if (expectedPricing.tier !== "course-member-virtual") {
    if (basePrice === null || basePrice <= 0) {
      throw new BadRequestException(
        "El curso no tiene un precio configurado. Contacta al administrador.",
      );
    }
  }

  const amount = expectedPricing.amount;
  let description: string;

  switch (expectedPricing.tier) {
    case "course-member-virtual":
      description = `Inscripción ${course.title} - Miembro (Virtual)`;
      break;
    case "course-member-semipresencial":
      description = `Inscripción ${course.title} - Miembro (Semipresencial)`;
      break;
    case "course-member-presencial":
      description = `Inscripción ${course.title} - Miembro (Presencial)`;
      break;
    case "course-non-member":
      description = `Inscripción ${course.title} - No Miembro`;
      break;
    default:
      throw new BadRequestException("Tier de pago inválido para curso");
  }

  const timestamp = Date.now();
  const shortUserId = userId.slice(-8);
  const reference = `${COURSE_TIER_REFERENCE_PREFIX[expectedPricing.tier]}-${shortUserId}-${timestamp}-${crypto.randomBytes(4).toString("hex")}`;

  const transaction = new deps.transactionModel({
    userId,
    eventSlug: dto.eventSlug,
    reference,
    amount,
    description,
    status: "PENDING",
    tier: expectedPricing.tier,
    hasCompanion: false,
    purpose: "course",
    relatedReference: null,
  });

  await transaction.save();

  if (amount === 0) {
    transaction.status = "APPROVED";
    await transaction.save();
    deps.logger.log(
      `Free course payment auto-approved: ${reference} for user ${userId}`,
    );
    await deps.linkPaymentByPurpose(transaction);
    await deps.processAlegraInvoicing(transaction);
    return {
      reference,
      amount,
      status: "APPROVED",
      requiresPayment: false,
    };
  }

  return buildBoldResponse(
    deps.configService,
    deps.logger,
    transaction,
    description,
  );
}
