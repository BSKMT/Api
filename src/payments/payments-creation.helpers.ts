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
import { ArphaService } from "../arpha/arpha.service";
import { UsersService } from "../users/users.service";
import { ShopService } from "../shop/shop.service";
import { isActiveMember } from "../common/utils/membership-access.util";
import {
  maskUserId,
  maskReference,
  maskAmount,
} from "../common/utils/log-redact.util";
import type { EnvironmentConfig } from "../config/config.interface";
import { ARPHA_TIER_LABEL, ARPHA_TIER_PREFIX } from "./payments.constants";
import {
  buildBoldCheckoutConfig,
  generateBoldIntegritySignatureShared,
  sanitizeBoldDescription,
} from "./bold.helpers";

export function generateBoldIntegritySignature(
  configService: ConfigService<EnvironmentConfig>,
  orderId: string,
  amount: number,
  currency: string,
): string {
  return generateBoldIntegritySignatureShared(
    configService,
    orderId,
    amount,
    currency,
  );
}

export function buildBoldConfigFor(
  configService: ConfigService<EnvironmentConfig>,
  reference: string,
  amount: number,
  description: string,
) {
  return buildBoldCheckoutConfig(configService, reference, amount, description);
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
  if (!isActiveMember(user)) {
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
  deps: CreatePaymentBaseDeps & { arphaService: ArphaService },
  userId: string,
  dto: CreatePaymentDto,
) {
  const requestId = dto.eventSlug;
  const arphaRequest = await deps.arphaService.findPendingRequestForUser(
    requestId,
    userId,
  );
  if (!arphaRequest) {
    throw new NotFoundException(
      "Solicitud ARPHA no encontrada, no te pertenece o ya fue pagada",
    );
  }

  const expectedTier = `arpha-${arphaRequest.requestType}`;
  if (dto.tier !== expectedTier) {
    throw new BadRequestException(
      `El tier de pago (${dto.tier}) no coincide con el tipo de solicitud ARPHA (${expectedTier})`,
    );
  }

  const amount = Math.round(
    arphaRequest.amount > 0
      ? arphaRequest.amount
      : (ARPHA_PRICING[arphaRequest.requestType] ?? 15000),
  );
  const label = ARPHA_TIER_LABEL[dto.tier] ?? "Asistencia ARPHA";
  const description = sanitizeBoldDescription(`ARPHA - ${label}`);

  const timestamp = Date.now();
  const shortUserId = userId.slice(-8);
  const reference = `${ARPHA_TIER_PREFIX[dto.tier]}-${shortUserId}-${timestamp}-${crypto.randomBytes(4).toString("hex")}`;

  const transaction = new deps.transactionModel({
    userId,
    eventSlug: requestId,
    reference,
    amount,
    description,
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
    description,
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

  const rawAmount = order.total;
  if (!Number.isFinite(rawAmount) || rawAmount < 0) {
    throw new BadRequestException("Monto de pago inválido");
  }
  const amount = Math.round(rawAmount);
  const description = sanitizeBoldDescription(
    `Compra Tienda BSK - ${orderNumber}`,
  );

  const timestamp = Date.now();
  const shortUserId = userId.slice(-8);
  const reference = `SHOP-${shortUserId}-${timestamp}-${crypto.randomBytes(4).toString("hex")}`;

  const transaction = new deps.transactionModel({
    userId,
    eventSlug: orderNumber,
    reference,
    amount,
    description,
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
    await deps.shopService.linkOrderPayment(orderNumber, reference);
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
