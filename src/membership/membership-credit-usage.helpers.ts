import * as crypto from "node:crypto";
import {
  BadRequestException,
  NotFoundException,
  ConflictException,
  Logger,
} from "@nestjs/common";
import { Model } from "mongoose";
import {
  ServiceCreditTransactionDocument,
  CreditTransactionType,
} from "./schemas/service-credit-transaction.schema";
import { UseCreditDto } from "./dto/use-credit.dto";
import { UsersService } from "../users/users.service";
import { CreditType } from "../users/schemas/user.schema";
import { maskAmount, maskUserId } from "../common/utils/log-redact.util";
import { isCreditExpired } from "./membership-credit-apply.helpers";

export interface CreditUsageDeps {
  usersService: UsersService;
  creditTransactionModel: Model<ServiceCreditTransactionDocument>;
  logger: Logger;
}

export async function useCreditHelper(
  deps: CreditUsageDeps,
  userId: string,
  dto: UseCreditDto,
) {
  const user = await deps.usersService.findById(userId);
  if (!user) throw new NotFoundException("Usuario no encontrado");

  // M-18: idempotency
  if (dto.idempotencyKey) {
    const prior = await deps.creditTransactionModel
      .findOne({
        userId,
        transactionType: CreditTransactionType.CREDIT_USED,
        "metadata.idempotencyKey": dto.idempotencyKey,
      })
      .lean();
    if (prior) {
      deps.logger.log(
        `Credit use idempotency hit: user=${maskUserId(userId)} ref=${prior.reference}`,
      );
      const fresh = await deps.usersService.findById(userId);
      const remainingCredit = fresh?.partialPaymentCredit
        ? (fresh.partialPaymentCredit.amount ?? 0) -
          (fresh.partialPaymentCredit.usedAmount ?? 0)
        : 0;
      return {
        success: true,
        amountUsed: prior.amount,
        remainingCredit,
        reference: prior.reference,
      };
    }
  }

  const credit = user.partialPaymentCredit;
  if (!credit) {
    throw new BadRequestException("No tienes crédito disponible");
  }

  const expectedType =
    dto.creditSource === "membership"
      ? CreditType.MEMBERSHIP
      : CreditType.SERVICES;

  if (credit.type !== expectedType) {
    throw new BadRequestException(
      `Tu crédito es de tipo ${credit.type}, no ${dto.creditSource}`,
    );
  }

  if (isCreditExpired(credit, new Date())) {
    throw new BadRequestException("Tu crédito ha expirado");
  }

  const availableAmount = credit.amount - credit.usedAmount;
  if (availableAmount <= 0) {
    throw new BadRequestException(
      "Tu crédito ya ha sido utilizado por completo",
    );
  }

  if (dto.amount > availableAmount) {
    throw new BadRequestException(
      `El monto solicitado (${dto.amount}) excede tu crédito disponible (${availableAmount})`,
    );
  }

  // A-3/A-4: Use atomic $inc with optimistic locking on expectedUsedAmount
  const updated =
    await deps.usersService.incrementPartialPaymentCreditUsedAmount(
      userId,
      dto.amount,
      credit.usedAmount,
    );
  if (!updated) {
    throw new ConflictException(
      "Conflicto al usar crédito: tu saldo fue modificado. Intenta de nuevo.",
    );
  }

  const timestamp = Date.now();
  const shortUserId = userId.slice(-8);
  const reference = `CRU-${shortUserId}-${timestamp}-${crypto.randomBytes(4).toString("hex")}`;
  await deps.creditTransactionModel.create({
    userId,
    reference,
    transactionType: CreditTransactionType.CREDIT_USED,
    creditSource: dto.creditSource,
    amount: dto.amount,
    description: dto.description ?? `Uso de crédito ${dto.creditSource}`,
    metadata: {
      idempotencyKey: dto.idempotencyKey ?? null,
    },
  });

  deps.logger.log(
    `Credit used: user=${maskUserId(userId)} amount=${maskAmount(dto.amount)} source=${dto.creditSource} remaining=${maskAmount(availableAmount - dto.amount)}`,
  );

  return {
    success: true,
    amountUsed: dto.amount,
    remainingCredit: availableAmount - dto.amount,
    reference,
  };
}

export async function getCreditBalanceHelper(
  deps: {
    usersService: UsersService;
    creditTransactionModel: Model<ServiceCreditTransactionDocument>;
  },
  userId: string,
) {
  const user = await deps.usersService.findById(userId);
  if (!user) throw new NotFoundException("Usuario no encontrado");

  const credit = user.partialPaymentCredit;
  if (!credit) {
    return { hasCredit: false };
  }

  const availableAmount = credit.amount - credit.usedAmount;
  const isExpired =
    credit.expiresAt != null && new Date(credit.expiresAt) < new Date();

  const transactions = await deps.creditTransactionModel
    .find({ userId })
    .sort({ createdAt: -1 })
    .select("-__v");

  return {
    hasCredit: true,
    credit: {
      type: credit.type,
      totalAmount: credit.amount,
      usedAmount: credit.usedAmount,
      availableAmount: isExpired ? 0 : availableAmount,
      installmentsPaid: credit.installmentsPaid,
      createdAt: credit.createdAt,
      convertedAt: credit.convertedAt,
      expiresAt: credit.expiresAt,
      isExpired,
      refundRequestedAt: credit.refundRequestedAt,
      notes: credit.notes,
    },
    transactions: transactions.map((t) => ({
      reference: t.reference,
      transactionType: t.transactionType,
      creditSource: t.creditSource,
      amount: t.amount,
      description: t.description,
      createdAt: t.createdAt,
    })),
  };
}
