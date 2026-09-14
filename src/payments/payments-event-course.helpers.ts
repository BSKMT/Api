import * as crypto from "node:crypto";
import { BadRequestException, NotFoundException, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Model } from "mongoose";
import { TransactionDocument } from "./schemas/transaction.schema";
import { CreatePaymentDto } from "./dto/create-payment.dto";
import { EventsService } from "../events/events.service";
import { UsersService } from "../users/users.service";
import type { EnvironmentConfig } from "../config/config.interface";
import {
  EVENT_TIER_REFERENCE_PREFIX,
  COURSE_TIER_REFERENCE_PREFIX,
  COMPANION_TIERS,
  MEMBER_TIERS,
} from "./payments.constants";
import {
  verifyActiveMember,
  buildBoldResponse,
} from "./payments-creation.helpers";

export interface EventCoursePaymentDeps {
  transactionModel: Model<TransactionDocument>;
  configService: ConfigService<EnvironmentConfig>;
  eventsService: EventsService;
  usersService: UsersService;
  logger: Logger;
  assertNoPendingForPurpose: (
    userId: string,
    purpose: string,
    slug: string,
  ) => Promise<void>;
  linkPaymentByPurpose: (transaction: TransactionDocument) => Promise<void>;
  processAlegraInvoicing: (transaction: TransactionDocument) => Promise<void>;
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

  // M-21: Fail-closed pricing — when a non-member-tier (or member-tier
  // with companion) requires a non-zero price we must reject the
  // payment intent instead of silently accepting a $0 charge.
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

  // M-21: Fail-closed pricing — only member-virtual tolerates unconfigured nonMemberPrice
  const basePrice = course.nonMemberPrice ?? null;
  if (dto.tier !== "course-member-virtual") {
    if (basePrice === null || basePrice <= 0) {
      throw new BadRequestException(
        "El curso no tiene un precio configurado. Contacta al administrador.",
      );
    }
  }
  const safeBasePrice = basePrice ?? 0;

  let amount: number;
  let description: string;

  switch (dto.tier) {
    case "course-member-virtual":
      amount = 0;
      description = `Inscripción ${course.title} - Miembro (Virtual)`;
      break;
    case "course-member-semipresencial":
      amount = Math.round(
        safeBasePrice * ((course.memberSemipresencialDiscount ?? 25) / 100),
      );
      description = `Inscripción ${course.title} - Miembro (Semipresencial)`;
      break;
    case "course-member-presencial":
      amount = Math.round(
        safeBasePrice * ((course.memberPresencialDiscount ?? 50) / 100),
      );
      description = `Inscripción ${course.title} - Miembro (Presencial)`;
      break;
    case "course-non-member":
      amount = safeBasePrice;
      description = `Inscripción ${course.title} - No Miembro`;
      break;
    default:
      throw new BadRequestException("Tier de pago inválido para curso");
  }

  const timestamp = Date.now();
  const shortUserId = userId.slice(-8);
  const reference = `${COURSE_TIER_REFERENCE_PREFIX[dto.tier]}-${shortUserId}-${timestamp}-${crypto.randomBytes(4).toString("hex")}`;

  const transaction = new deps.transactionModel({
    userId,
    eventSlug: dto.eventSlug,
    reference,
    amount,
    description,
    status: "PENDING",
    tier: dto.tier,
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
