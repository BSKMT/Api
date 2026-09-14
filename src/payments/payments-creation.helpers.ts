import * as crypto from "node:crypto";
import {
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Model } from "mongoose";
import { TransactionDocument } from "./schemas/transaction.schema";
import { CreatePaymentDto } from "./dto/create-payment.dto";
import { ARPHA_PRICING } from "../arpha/schemas/arpha-request.schema";
import { UsersService } from "../users/users.service";
import { UserRole } from "../users/schemas/user.schema";
import { ShopService } from "../shop/shop.service";
import {
  maskUserId,
  maskReference,
  maskAmount,
} from "../common/utils/log-redact.util";
import type { EnvironmentConfig } from "../config/config.interface";
import { ARPHA_TIER_LABEL, ARPHA_TIER_PREFIX } from "./payments.constants";

export function generateBoldIntegritySignature(
  configService: ConfigService<EnvironmentConfig>,
  orderId: string,
  amount: number,
  currency: string,
): string {
  const secretKey = configService.get<string>("BOLD_SECRET_KEY", {
    infer: true,
  });
  if (!secretKey) {
    throw new BadRequestException("BOLD_SECRET_KEY not configured");
  }
  const concatenated = `${orderId}${amount}${currency}${secretKey}`;
  return crypto.createHash("sha256").update(concatenated).digest("hex");
}

export function buildBoldConfigFor(
  configService: ConfigService<EnvironmentConfig>,
  reference: string,
  amount: number,
  description: string,
) {
  const boldEnvironment =
    configService.get<string>("BOLD_ENVIRONMENT", {
      infer: true,
    }) ?? "sandbox";
  const boldPublicKey =
    configService.get<string>("BOLD_PUBLIC_KEY", {
      infer: true,
    }) ?? "";
  const boldBaseUrl =
    boldEnvironment === "production"
      ? "https://payments.api.bold.co"
      : "https://payments-api-test.bold.co";
  return {
    publicKey: boldPublicKey,
    environment: boldEnvironment,
    baseUrl: boldBaseUrl,
    referenceId: reference,
    description,
    amount,
    currency: "COP",
    integritySignature: generateBoldIntegritySignature(
      configService,
      reference,
      amount,
      "COP",
    ),
  };
}

export function buildBoldResponse(
  configService: ConfigService<EnvironmentConfig>,
  logger: Logger,
  transaction: TransactionDocument,
  description: string,
) {
  logger.log(
    `Payment intent created: ref=${maskReference(transaction.reference)} user=${maskUserId(transaction.userId)} amount=${maskAmount(transaction.amount)} COP`,
  );

  return {
    reference: transaction.reference,
    amount: transaction.amount,
    status: "PENDING",
    requiresPayment: true,
    boldConfig: buildBoldConfigFor(
      configService,
      transaction.reference,
      transaction.amount,
      description,
    ),
  };
}

export async function verifyActiveMember(
  usersService: UsersService,
  userId: string,
): Promise<void> {
  const user = await usersService.findById(userId);
  if (!user) throw new NotFoundException("Usuario no encontrado");
  const now = new Date();
  const membershipExpired =
    user.membershipExpiryDate != null &&
    new Date(user.membershipExpiryDate) < now;
  const isActiveMember =
    (user.role as UserRole) === UserRole.MEMBER &&
    !membershipExpired &&
    !!user.membershipLevel;
  if (!isActiveMember) {
    throw new ForbiddenException(
      "No tienes una membresía activa para usar este tier de precio",
    );
  }
}

export interface CreatePaymentBaseDeps {
  transactionModel: Model<TransactionDocument>;
  configService: ConfigService<EnvironmentConfig>;
  logger: Logger;
}

export async function createArphaPaymentHelper(
  deps: CreatePaymentBaseDeps,
  userId: string,
  dto: CreatePaymentDto,
) {
  const requestId = dto.eventSlug;
  const amount = ARPHA_PRICING[dto.tier.replace("arpha-", "")] ?? 15000;
  const label = ARPHA_TIER_LABEL[dto.tier] ?? "Asistencia ARPHA";

  const timestamp = Date.now();
  const shortUserId = userId.slice(-8);
  const reference = `${ARPHA_TIER_PREFIX[dto.tier]}-${shortUserId}-${timestamp}-${crypto.randomBytes(4).toString("hex")}`;

  const transaction = new deps.transactionModel({
    userId,
    eventSlug: requestId,
    reference,
    amount,
    description: `ARPHA - ${label}`,
    status: "PENDING",
    tier: dto.tier,
    hasCompanion: false,
    purpose: "arpha",
    relatedReference: requestId,
  });

  await transaction.save();

  return buildBoldResponse(
    deps.configService,
    deps.logger,
    transaction,
    `ARPHA - ${label}`,
  );
}

export async function createShopPaymentHelper(
  deps: CreatePaymentBaseDeps & {
    shopService: ShopService;
    processAlegraInvoicing: (t: TransactionDocument) => Promise<void>;
  },
  userId: string,
  dto: CreatePaymentDto,
) {
  const orderNumber = dto.relatedReference ?? dto.productSlug;
  if (!orderNumber) {
    throw new BadRequestException(
      "relatedReference (orderNumber) requerido para pagos de tienda",
    );
  }

  const order = await deps.shopService.getOrderByOrderNumber(
    orderNumber,
    userId,
    true,
  );
  if (!order) {
    throw new NotFoundException(
      "Orden no encontrada, no te pertenece, o ya fue pagada",
    );
  }

  const amount = order.total;
  if (Number.isNaN(amount) || amount < 0) {
    throw new BadRequestException("Monto de pago inválido");
  }

  const timestamp = Date.now();
  const shortUserId = userId.slice(-8);
  const reference = `SHOP-${shortUserId}-${timestamp}-${crypto.randomBytes(4).toString("hex")}`;

  const transaction = new deps.transactionModel({
    userId,
    eventSlug: orderNumber,
    reference,
    amount,
    description: `Compra Tienda BSK - ${orderNumber}`,
    status: "PENDING",
    tier: dto.tier,
    hasCompanion: false,
    purpose: "shop",
    relatedReference: orderNumber,
  });

  await transaction.save();

  if (amount === 0) {
    transaction.status = "APPROVED";
    await transaction.save();
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
    `Compra Tienda BSK - ${orderNumber}`,
  );
}
