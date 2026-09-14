import { BadRequestException, NotFoundException, Logger } from "@nestjs/common";
import { Model } from "mongoose";
import { MembershipTransactionDocument } from "./schemas/membership-transaction.schema";
import { UsersService } from "../users/users.service";
import { AlegraService } from "../alegra/alegra.service";
import { maskReference } from "../common/utils/log-redact.util";
import {
  formatStoredMembershipDescription,
  buildBoldConfig,
} from "./membership-formatting.helpers";
import { syncWithBold, MembershipSyncDeps } from "./membership-sync.helpers";

export async function getMembershipPaymentHelper(
  deps: MembershipSyncDeps,
  userId: string,
  reference: string,
) {
  const transaction = await deps.transactionModel.findOne({
    userId,
    reference,
  });
  if (!transaction) {
    throw new NotFoundException("Transacción de membresía no encontrada");
  }

  if (transaction.status === "PENDING") {
    await syncWithBold(deps, transaction);
  }

  const description = formatStoredMembershipDescription(
    transaction.paymentPlan,
    transaction.isRenewal,
    transaction.installmentNumber,
    transaction.installmentTotal,
  );

  const result: any = {
    reference: transaction.reference,
    type: "membership",
    paymentPlan: transaction.paymentPlan,
    amount: transaction.amount,
    installmentNumber: transaction.installmentNumber,
    installmentTotal: transaction.installmentTotal,
    isRenewal: transaction.isRenewal,
    status: transaction.status,
    paidAt: transaction.paidAt,
    paymentMethod: transaction.paymentMethod ?? null,
    description,
    requiresPayment: transaction.status !== "APPROVED",
  };

  if (transaction.status === "PENDING") {
    result.boldConfig = buildBoldConfig(
      deps.configService,
      transaction.reference,
      transaction.amount,
      description,
    );
  }

  return result;
}

export async function getMembershipStatusHelper(
  deps: {
    transactionModel: Model<MembershipTransactionDocument>;
    usersService: UsersService;
    alegraService: AlegraService;
  },
  userId: string,
) {
  const user = await deps.usersService.findById(userId);
  if (!user) throw new NotFoundException("Usuario no encontrado");

  const now = new Date();
  const isExpired =
    user.membershipExpiryDate != null &&
    new Date(user.membershipExpiryDate) < now;

  const isInGracePeriod =
    isExpired &&
    user.membershipGracePeriodEnd != null &&
    new Date(user.membershipGracePeriodEnd) > now;

  const transactions = await deps.transactionModel
    .find({ userId })
    .sort({ createdAt: -1 })
    .select("-webhookEvents -__v");

  const alegraInvoices = await deps.alegraService.getInvoicesForUser(userId);

  return {
    role: user.role,
    membershipLevel: user.membershipLevel,
    membershipStartDate: user.membershipStartDate,
    membershipExpiryDate: user.membershipExpiryDate,
    membershipGracePeriodEnd: user.membershipGracePeriodEnd,
    isExpired,
    isInGracePeriod,
    membershipExpired: user.membershipExpired,
    membershipPaymentPlan: user.membershipPaymentPlan,
    installmentsPaid: user.installmentsPaid,
    installmentsTotal: user.installmentsTotal,
    renewalInstallmentsPaid: user.renewalInstallmentsPaid,
    partialPaymentCredit: user.partialPaymentCredit,
    transactions: transactions.map((t) => {
      const key = `${t.reference}:membership`;
      const inv = alegraInvoices.get(key);
      return {
        reference: t.reference,
        amount: t.amount,
        status: t.status,
        installmentNumber: t.installmentNumber,
        installmentTotal: t.installmentTotal,
        paymentPlan: t.paymentPlan,
        isRenewal: t.isRenewal,
        paidAt: t.paidAt,
        createdAt: t.createdAt,
        invoice: inv
          ? {
              alegraInvoiceId: inv.alegraInvoiceId,
              invoiceNumber: inv.alegraInvoiceNumber,
              cufe: inv.cufe,
              stampStatus: inv.stampStatus,
              status: inv.status,
              emailed: inv.emailed,
              errorMessage: inv.errorMessage,
            }
          : null,
      };
    }),
  };
}

export async function cancelPendingMembershipTransactionHelper(
  deps: {
    transactionModel: Model<MembershipTransactionDocument>;
    usersService: UsersService;
    logger: Logger;
  },
  userId: string,
  reference: string,
): Promise<{ message: string }> {
  const transaction = await deps.transactionModel.findOne({
    userId,
    reference,
  });

  if (!transaction) {
    throw new NotFoundException("Transacción de membresía no encontrada");
  }

  if (transaction.status !== "PENDING") {
    throw new BadRequestException(
      "Solo se pueden cancelar transacciones pendientes",
    );
  }

  transaction.status = "VOIDED";

  if (transaction.creditUsedAmount > 0 && !transaction.creditReverted) {
    const reverted = await deps.usersService.revertPartialPaymentCredit(
      transaction.userId,
      transaction.creditUsedAmount,
    );
    if (reverted) {
      transaction.creditReverted = true;
    }
  }

  await transaction.save();
  deps.logger.log(
    `Membership transaction cancelled by user: ref=${maskReference(reference)}`,
  );

  return { message: "Transacción de membresía cancelada exitosamente" };
}
