import * as crypto from "node:crypto";
import { BadRequestException, ConflictException, Logger } from "@nestjs/common";
import { Model } from "mongoose";
import {
  ServiceCreditTransactionDocument,
  CreditTransactionType,
  CreditSource,
} from "./schemas/service-credit-transaction.schema";
import { MembershipTransactionDocument } from "./schemas/membership-transaction.schema";
import { CreateMembershipPaymentDto } from "./dto/create-membership-payment.dto";
import { UsersService } from "../users/users.service";
import { CreditType } from "../users/schemas/user.schema";
import type { PartialPaymentCredit } from "../users/schemas/user.schema";
import {
  maskAmount,
  maskReference,
  maskUserId,
} from "../common/utils/log-redact.util";

export interface MembershipPaymentContext {
  installmentNumber: number;
  installmentTotal: number;
  isRenewal: boolean;
}

export function isCreditExpired(
  credit: { expiresAt: Date | null },
  now: Date,
): boolean {
  return credit.expiresAt ? new Date(credit.expiresAt) < now : false;
}

export async function applyCreditIfRequested(
  deps: {
    usersService: UsersService;
    creditTransactionModel: Model<ServiceCreditTransactionDocument>;
    logger: Logger;
  },
  userId: string,
  dto: CreateMembershipPaymentDto,
  user: { partialPaymentCredit?: PartialPaymentCredit | null },
  totalAmount: number,
  ctx: MembershipPaymentContext,
  now: Date,
): Promise<{ creditUsedAmount: number; remainingAmount: number }> {
  const { installmentNumber, installmentTotal, isRenewal } = ctx;
  if (!dto.useCredit || !dto.creditAmount || dto.creditAmount <= 0) {
    return { creditUsedAmount: 0, remainingAmount: totalAmount };
  }
  const credit = user.partialPaymentCredit;
  if (credit?.type !== CreditType.MEMBERSHIP) {
    throw new BadRequestException("No tienes crédito de membresía disponible");
  }
  if (isCreditExpired(credit, now)) {
    throw new BadRequestException("Tu crédito ha expirado");
  }
  const availableCredit = credit.amount - credit.usedAmount;
  if (availableCredit <= 0) {
    throw new BadRequestException(
      "Tu crédito ya ha sido utilizado por completo",
    );
  }

  const creditUsedAmount = Math.min(
    dto.creditAmount,
    availableCredit,
    totalAmount,
  );
  const remainingAmount = totalAmount - creditUsedAmount;

  // A-3: Use atomic $inc with optimistic locking on expectedUsedAmount
  const updated =
    await deps.usersService.incrementPartialPaymentCreditUsedAmount(
      userId,
      creditUsedAmount,
      credit.usedAmount,
    );
  if (!updated) {
    throw new ConflictException(
      "Conflicto al aplicar crédito: tu saldo fue modificado. Intenta de nuevo.",
    );
  }

  const timestamp = Date.now();
  const shortUserId = userId.slice(-8);
  const creditRef = `CRU-${shortUserId}-${timestamp}-${crypto.randomBytes(4).toString("hex")}`;
  await deps.creditTransactionModel.create({
    userId,
    reference: creditRef,
    transactionType: CreditTransactionType.CREDIT_USED,
    creditSource: CreditSource.MEMBERSHIP,
    amount: creditUsedAmount,
    description: `Crédito aplicado a ${isRenewal ? "renovación" : "nueva"} membresía — cuota ${installmentNumber}/${installmentTotal}`,
    metadata: {
      membershipPaymentPlan: dto.paymentPlan,
      installmentNumber,
      isRenewal,
    },
  });

  deps.logger.log(
    `Credit applied to membership: user=${maskUserId(userId)} creditAmount=${maskAmount(creditUsedAmount)} remaining=${maskAmount(remainingAmount)}`,
  );

  return { creditUsedAmount, remainingAmount };
}

export async function revertCreditIfUsed(
  deps: {
    usersService: UsersService;
    transactionModel: Model<MembershipTransactionDocument>;
    logger: Logger;
  },
  transaction: MembershipTransactionDocument,
): Promise<void> {
  if (transaction.creditUsedAmount > 0 && !transaction.creditReverted) {
    const reverted = await deps.usersService.revertPartialPaymentCredit(
      transaction.userId,
      transaction.creditUsedAmount,
    );
    if (reverted) {
      await deps.transactionModel.updateOne(
        { _id: transaction._id, creditReverted: false },
        { $set: { creditReverted: true } },
      );
      deps.logger.log(
        `Credit reverted: user=${maskUserId(transaction.userId)} amount=${maskAmount(transaction.creditUsedAmount)} ref=${maskReference(transaction.reference)}`,
      );
    }
  }
}
