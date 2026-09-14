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
  CreditSource,
} from "./schemas/service-credit-transaction.schema";
import { CreditChoiceDto } from "./dto/credit-choice.dto";
import { UsersService } from "../users/users.service";
import { CreditType } from "../users/schemas/user.schema";
import {
  maskAmount,
  maskReference,
  maskUserId,
} from "../common/utils/log-redact.util";
import { CREDIT_EXPIRY_MONTHS } from "./membership.constants";

export interface CreditChoiceDeps {
  usersService: UsersService;
  creditTransactionModel: Model<ServiceCreditTransactionDocument>;
  logger: Logger;
}

export async function chooseCreditOptionHelper(
  deps: CreditChoiceDeps,
  userId: string,
  dto: CreditChoiceDto,
) {
  const user = await deps.usersService.findById(userId);
  if (!user) throw new NotFoundException("Usuario no encontrado");

  const credit = user.partialPaymentCredit;
  if (credit?.type !== CreditType.PENDING) {
    throw new BadRequestException(
      "No tienes crédito pendiente para administrar",
    );
  }

  const availableAmount = credit.amount - credit.usedAmount;
  if (availableAmount <= 0) {
    throw new BadRequestException(
      "Tu crédito ya ha sido utilizado por completo",
    );
  }

  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setMonth(expiresAt.getMonth() + CREDIT_EXPIRY_MONTHS);

  const timestamp = Date.now();
  const shortUserId = userId.slice(-8);
  let newType: CreditType;
  let transactionType: CreditTransactionType;
  let creditSource: CreditSource;
  let description: string;

  switch (dto.choice) {
    case "membership":
      newType = CreditType.MEMBERSHIP;
      transactionType = CreditTransactionType.CREDIT_CONVERTED_FROM_RENEWAL;
      creditSource = CreditSource.MEMBERSHIP;
      description = `Crédito de renovación parcial convertido en crédito para futura membresía (${credit.installmentsPaid} cuotas)`;
      break;
    case "services":
      newType = CreditType.SERVICES;
      transactionType = CreditTransactionType.CREDIT_GRANTED;
      creditSource = CreditSource.SERVICES;
      description = `Crédito de renovación parcial convertido en crédito para servicios BSK (${credit.installmentsPaid} cuotas)`;
      break;
    case "refund":
      newType = CreditType.REFUND_REQUESTED;
      transactionType = CreditTransactionType.CREDIT_GRANTED;
      creditSource = CreditSource.MEMBERSHIP;
      description = `Solicitud de reembolso para crédito de renovación parcial (${credit.installmentsPaid} cuotas)`;
      break;
    default:
      throw new BadRequestException("Opción de crédito inválida");
  }

  // M-20: Atomic transition — credit must still be PENDING
  const didUpdate = await deps.usersService.updatePartialPaymentCreditIfType(
    userId,
    CreditType.PENDING,
    {
      ...credit,
      type: newType,
      convertedAt: now,
      expiresAt: dto.choice !== "refund" ? expiresAt : null,
      refundRequestedAt: dto.choice === "refund" ? now : null,
      notes: description,
    },
  );
  if (!didUpdate) {
    deps.logger.warn(
      `chooseCreditOption race aborted: user=${maskUserId(userId)} (credit no longer PENDING)`,
    );
    throw new ConflictException(
      "Tu crédito fue procesado concurrentemente. Refresca e intenta de nuevo.",
    );
  }

  const reference = `CR-${creditSource.toUpperCase()}-${shortUserId}-${timestamp}-${crypto.randomBytes(4).toString("hex")}`;
  await deps.creditTransactionModel.create({
    userId,
    reference,
    transactionType,
    creditSource,
    amount: availableAmount,
    description,
    metadata: {
      installmentsPaid: credit.installmentsPaid,
      originalCreditAmount: credit.amount,
    },
  });

  deps.logger.log(
    `Credit choice processed: user=${maskUserId(userId)} choice=${dto.choice} amount=${maskAmount(availableAmount)}`,
  );

  return {
    success: true,
    choice: dto.choice,
    credit: {
      type: newType,
      amount: availableAmount,
      expiresAt: dto.choice !== "refund" ? expiresAt : null,
      description,
    },
  };
}

export async function requestRefundHelper(
  deps: CreditChoiceDeps,
  userId: string,
) {
  const user = await deps.usersService.findById(userId);
  if (!user) throw new NotFoundException("Usuario no encontrado");

  const credit = user.partialPaymentCredit;
  if (!credit) {
    throw new BadRequestException("No tienes crédito disponible");
  }

  if (credit.type !== CreditType.REFUND_REQUESTED) {
    throw new BadRequestException(
      "Primero debes elegir la opción de reembolso desde el panel de créditos",
    );
  }

  if (credit.usedAmount > 0) {
    throw new BadRequestException(
      "Ya has utilizado parte de tu crédito. No puedes solicitar reembolso",
    );
  }

  // M-19: deduplicate
  const existing = await deps.creditTransactionModel
    .findOne({
      userId,
      transactionType: CreditTransactionType.CREDIT_REFUNDED,
      "metadata.status": "pending-admin-approval",
    })
    .lean();
  if (existing) {
    throw new ConflictException(
      `Ya tienes una solicitud de reembolso pendiente. Ref: ${existing.reference}`,
    );
  }

  const timestamp = Date.now();
  const shortUserId = userId.slice(-8);
  const reference = `REF-${shortUserId}-${timestamp}-${crypto.randomBytes(4).toString("hex")}`;

  await deps.creditTransactionModel.create({
    userId,
    reference,
    transactionType: CreditTransactionType.CREDIT_REFUNDED,
    creditSource: CreditSource.MEMBERSHIP,
    amount: credit.amount,
    description: `Reembolso de crédito de renovación parcial (${credit.installmentsPaid} cuotas)`,
    metadata: {
      installmentsPaid: credit.installmentsPaid,
      status: "pending-admin-approval",
    },
  });

  await deps.usersService.updatePartialPaymentCredit(userId, {
    ...credit,
    type: CreditType.REFUND_REQUESTED,
    notes: `Reembolso solicitado - Pendiente aprobación admin. Ref: ${reference}`,
  });

  deps.logger.log(
    `Refund requested: user=${maskUserId(userId)} amount=${maskAmount(credit.amount)} ref=${maskReference(reference)}`,
  );

  return {
    success: true,
    reference,
    amount: credit.amount,
    status: "pending-admin-approval",
    message:
      "Tu solicitud de reembolso ha sido registrada. Un administrador la revisará en los próximos días hábiles.",
  };
}
