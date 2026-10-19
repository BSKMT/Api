import * as crypto from "node:crypto";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { CreatePaymentDto } from "./dto/create-payment.dto";
import {
  EVENT_TIER_REFERENCE_PREFIX,
  COMPANION_TIERS,
  MEMBER_TIERS,
} from "./payments.constants";
import {
  verifyActiveMember,
  buildBoldResponse,
} from "./payments-creation.helpers";
import type { EventCoursePaymentDeps } from "./payments-event-course.helpers";

function validateEventRegistrationAndTier(
  registration: {
    registrationType?: string;
    attendanceMode?: string;
    paymentConfirmed?: boolean;
  } | null,
  tier: string,
) {
  if (!registration) {
    throw new BadRequestException(
      "Debes registrarte previamente en el evento antes de iniciar el pago.",
    );
  }
  if (registration.paymentConfirmed) {
    throw new BadRequestException(
      "La inscripción para este evento ya se encuentra pagada y confirmada.",
    );
  }

  const isWithCompanionReg =
    registration.attendanceMode === "with-companion" ||
    registration.registrationType === "with-companion";
  const isCompanionTier = COMPANION_TIERS.has(tier);

  if (isWithCompanionReg && !isCompanionTier) {
    throw new BadRequestException(
      "Tu inscripción incluye acompañante. El tier de pago seleccionado debe ser con acompañante.",
    );
  }
  if (!isWithCompanionReg && isCompanionTier) {
    throw new BadRequestException(
      "Tu inscripción es individual. No puedes seleccionar un tier con acompañante.",
    );
  }
}

function calculateEventTierAmountAndDescription(
  event: {
    title: string;
    membersFree?: boolean;
    nonMemberPrice?: number | null;
    companionPrice?: number | null;
  },
  tier: string,
): { amount: number; description: string } {
  const isNonMemberTier = !MEMBER_TIERS.has(tier);
  const requiresPrice = isNonMemberTier || tier === "member-companion";
  const basePrice = event.nonMemberPrice ?? null;
  if (requiresPrice && (basePrice === null || basePrice <= 0)) {
    throw new BadRequestException(
      "El evento no tiene un precio configurado. Contacta al administrador.",
    );
  }
  const safeBasePrice = basePrice ?? 0;
  const companionPrice =
    event.companionPrice ?? Math.round(safeBasePrice * 0.5);

  switch (tier) {
    case "member-solo": {
      const isFree = Boolean(event.membersFree);
      return {
        amount: isFree ? 0 : safeBasePrice,
        description: `Inscripción ${event.title} - Miembro (Solo)${isFree ? "" : " (Evento pago)"}`,
      };
    }
    case "member-companion":
      return {
        amount: event.membersFree
          ? companionPrice
          : safeBasePrice + companionPrice,
        description: `Inscripción ${event.title} - Miembro (Con acompañante)`,
      };
    case "non-member-solo":
      return {
        amount: safeBasePrice,
        description: `Inscripción ${event.title} - No Miembro (Solo)`,
      };
    case "non-member-companion":
      return {
        amount: safeBasePrice + companionPrice,
        description: `Inscripción ${event.title} - No Miembro (Con acompañante)`,
      };
    default:
      throw new BadRequestException("Tier de pago inválido para evento");
  }
}

export async function createEventPaymentHelper(
  deps: EventCoursePaymentDeps,
  userId: string,
  dto: CreatePaymentDto,
) {
  if (MEMBER_TIERS.has(dto.tier)) {
    await verifyActiveMember(deps.usersService, userId);
  }

  await deps.assertNoPendingForPurpose(userId, "event", dto.eventSlug);

  const event = await deps.eventsService.getEventBySlug(dto.eventSlug);
  if (!event) {
    throw new NotFoundException("Evento no encontrado");
  }

  const registration = await deps.eventsService.getRegistration(
    userId,
    dto.eventSlug,
  );
  validateEventRegistrationAndTier(registration, dto.tier);

  const { amount, description } = calculateEventTierAmountAndDescription(
    event,
    dto.tier,
  );

  const hasCompanion = COMPANION_TIERS.has(dto.tier);
  const timestamp = Date.now();
  const shortUserId = userId.slice(-8);
  const reference = `${EVENT_TIER_REFERENCE_PREFIX[dto.tier]}-${shortUserId}-${timestamp}-${crypto.randomBytes(4).toString("hex")}`;

  const transaction = new deps.transactionModel({
    userId,
    eventSlug: dto.eventSlug,
    reference,
    amount,
    description,
    status: "PENDING",
    tier: dto.tier,
    hasCompanion,
    purpose: "event",
    relatedReference: null,
  });

  await transaction.save();

  if (amount === 0) {
    transaction.status = "APPROVED";
    await transaction.save();
    deps.logger.log(
      `Free tier payment auto-approved: ${reference} for user ${userId}`,
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
