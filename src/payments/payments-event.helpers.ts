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

  const isWithCompanionReg = registration.registrationType === "with-companion";
  const isCompanionTier = COMPANION_TIERS.has(dto.tier);

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

  const isNonMemberTier = !MEMBER_TIERS.has(dto.tier);
  const requiresPrice = isNonMemberTier || dto.tier === "member-companion";
  const basePrice = event.nonMemberPrice ?? null;
  if (requiresPrice && (basePrice === null || basePrice <= 0)) {
    throw new BadRequestException(
      "El evento no tiene un precio configurado. Contacta al administrador.",
    );
  }
  const safeBasePrice = basePrice ?? 0;
  const companionPrice =
    event.companionPrice ?? Math.round(safeBasePrice * 0.5);

  let amount: number;
  let description: string;

  switch (dto.tier) {
    case "member-solo":
      amount = event.membersFree ? 0 : safeBasePrice;
      description = `Inscripción ${event.title} - Miembro (Solo)${event.membersFree ? "" : " (Evento pago)"}`;
      break;
    case "member-companion":
      amount = event.membersFree
        ? companionPrice
        : safeBasePrice + companionPrice;
      description = `Inscripción ${event.title} - Miembro (Con acompañante)`;
      break;
    case "non-member-solo":
      amount = safeBasePrice;
      description = `Inscripción ${event.title} - No Miembro (Solo)`;
      break;
    case "non-member-companion":
      amount = safeBasePrice + companionPrice;
      description = `Inscripción ${event.title} - No Miembro (Con acompañante)`;
      break;
    default:
      throw new BadRequestException("Tier de pago inválido para evento");
  }

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
