import { Logger } from "@nestjs/common";
import { Model } from "mongoose";
import { MembershipTransactionDocument } from "./schemas/membership-transaction.schema";
import { UsersService } from "../users/users.service";
import { NotificationsService } from "../notifications/notifications.service";
import { AlegraService } from "../alegra/alegra.service";
import {
  NotificationType,
  NotificationPriority,
} from "../notifications/schemas/notification.schema";
import { maskUserId } from "../common/utils/log-redact.util";
import {
  INSTALLMENTS_TOTAL,
  MEMBERSHIP_DURATION_MS,
} from "./membership.constants";
import { formatRenewalActivationMessage } from "./membership-formatting.helpers";
import { processAlegraInvoicingHelper } from "./membership-invoicing.helpers";

export interface MembershipActivationDeps {
  transactionModel: Model<MembershipTransactionDocument>;
  usersService: UsersService;
  notificationsService: NotificationsService;
  alegraService: AlegraService;
  logger: Logger;
}

export async function processApprovedPaymentHelper(
  deps: MembershipActivationDeps,
  transaction: MembershipTransactionDocument,
): Promise<void> {
  if (transaction.benefitGranted) {
    deps.logger.log(
      `Benefit already granted for ${transaction.reference}, skipping`,
    );
    return;
  }
  const claimResult = await deps.transactionModel.updateOne(
    { _id: transaction._id, benefitGranted: false },
    { $set: { benefitGranted: true } },
  );
  if (claimResult.matchedCount === 0 || claimResult.modifiedCount === 0) {
    deps.logger.log(
      `Concurrent benefit-grant for ${transaction.reference}; skipping`,
    );
    return;
  }
  transaction.benefitGranted = true;

  const user = await deps.usersService.findById(transaction.userId);
  if (!user) {
    deps.logger.warn(
      `User not found for approved membership payment: ${transaction.userId}`,
    );
    return;
  }

  if (transaction.isRenewal) {
    await processRenewalApprovalHelper(deps, transaction, user);
  } else if (transaction.paymentPlan === "single") {
    await processSingleNewPaymentActivationHelper(deps, transaction, user);
  } else {
    await processInstallmentApprovalHelper(deps, transaction, user);
  }

  await processAlegraInvoicingHelper(deps, transaction);
}

export async function processRenewalApprovalHelper(
  deps: MembershipActivationDeps,
  transaction: MembershipTransactionDocument,
  user: { email: string; membershipExpiryDate?: Date | null },
): Promise<void> {
  const newRenewalCount =
    await deps.usersService.incrementRenewalInstallmentsPaid(
      transaction.userId,
    );

  const isComplete =
    transaction.paymentPlan === "single" ||
    newRenewalCount >= INSTALLMENTS_TOTAL;

  if (!isComplete) {
    await deps.notificationsService.create({
      userId: transaction.userId,
      type: NotificationType.MEMBERSHIP_INSTALLMENT_PAID,
      title: `Cuota de renovación ${newRenewalCount}/${INSTALLMENTS_TOTAL} pagada`,
      message: `Hemos registrado tu pago. Te faltan ${INSTALLMENTS_TOTAL - newRenewalCount} cuotas para completar tu renovación.`,
      priority: NotificationPriority.MEDIUM,
      metadata: {
        installmentNumber: newRenewalCount,
        installmentTotal: INSTALLMENTS_TOTAL,
        isRenewal: true,
      },
      notifyCategory: "Membresia y pagos",
      relatedReference: transaction.reference,
    });
    return;
  }

  await activateRenewalMembershipHelper(
    deps,
    transaction,
    user,
    newRenewalCount,
  );
}

export async function activateRenewalMembershipHelper(
  deps: MembershipActivationDeps,
  transaction: MembershipTransactionDocument,
  user: { email: string; membershipExpiryDate?: Date | null },
  newRenewalCount: number,
): Promise<void> {
  const now = new Date();
  const currentExpiry = user.membershipExpiryDate
    ? new Date(user.membershipExpiryDate)
    : now;
  const baseDate = currentExpiry > now ? currentExpiry : now;
  const newExpiry = new Date(baseDate.getTime() + MEMBERSHIP_DURATION_MS);

  await deps.usersService.activateMembership(
    transaction.userId,
    baseDate,
    newExpiry,
    transaction.paymentPlan === "single" ? "single" : "installments",
  );

  deps.logger.log(
    `Membership renewed: user=${maskUserId(transaction.userId)} expiry=${newExpiry.toISOString()}`,
  );

  await deps.notificationsService.create({
    userId: transaction.userId,
    type: NotificationType.MEMBERSHIP_ACTIVATED,
    title: "Membresía renovada",
    message: formatRenewalActivationMessage(transaction.paymentPlan, newExpiry),
    priority: NotificationPriority.HIGH,
    metadata: {
      paymentPlan: transaction.paymentPlan,
      renewalInstallmentsPaid: newRenewalCount,
      newExpiry: newExpiry.toISOString(),
    },
    relatedReference: transaction.reference,
    notifyCategory: "Membresia y pagos",
  });
}

export async function processSingleNewPaymentActivationHelper(
  deps: MembershipActivationDeps,
  transaction: MembershipTransactionDocument,
  _user: { email: string },
): Promise<void> {
  const now = new Date();
  const expiry = new Date(now.getTime() + MEMBERSHIP_DURATION_MS);
  await deps.usersService.activateMembership(
    transaction.userId,
    now,
    expiry,
    "single",
  );
  deps.logger.log(
    `Membership activated (single payment): user=${maskUserId(transaction.userId)} expiry=${expiry.toISOString()}`,
  );

  await deps.notificationsService.create({
    userId: transaction.userId,
    type: NotificationType.MEMBERSHIP_ACTIVATED,
    title: "Membresía Legend activada",
    message: `Tu pago único fue confirmado. Tu membresía Legend está activa hasta el ${expiry.toLocaleDateString("es-CO")}. ¡Bienvenido al ecosistema BSK!`,
    priority: NotificationPriority.HIGH,
    metadata: {
      paymentPlan: "single",
      amount: transaction.amount,
      newExpiry: expiry.toISOString(),
    },
    relatedReference: transaction.reference,
    notifyCategory: "Membresia y pagos",
  });
}

export async function processInstallmentApprovalHelper(
  deps: MembershipActivationDeps,
  transaction: MembershipTransactionDocument,
  user: { email: string },
): Promise<void> {
  const approvedCount = await deps.usersService.incrementInstallmentsPaid(
    transaction.userId,
  );

  if (approvedCount >= INSTALLMENTS_TOTAL) {
    await activateCompleteInstallmentsMembershipHelper(
      deps,
      transaction,
      user,
      approvedCount,
    );
  } else {
    deps.logger.log(
      `Installment ${approvedCount}/${INSTALLMENTS_TOTAL} paid: user=${maskUserId(transaction.userId)}`,
    );
    await deps.notificationsService.create({
      userId: transaction.userId,
      type: NotificationType.MEMBERSHIP_INSTALLMENT_PAID,
      title: `Cuota ${approvedCount}/${INSTALLMENTS_TOTAL} pagada`,
      message: `Hemos registrado tu pago de la cuota ${approvedCount} de ${INSTALLMENTS_TOTAL}. Te faltan ${INSTALLMENTS_TOTAL - approvedCount} cuotas para activar tu membresía Legend.`,
      priority: NotificationPriority.MEDIUM,
      metadata: {
        installmentNumber: approvedCount,
        installmentTotal: INSTALLMENTS_TOTAL,
        amount: transaction.amount,
      },
      relatedReference: transaction.reference,
      notifyCategory: "Membresia y pagos",
    });
  }
}

export async function activateCompleteInstallmentsMembershipHelper(
  deps: MembershipActivationDeps,
  transaction: MembershipTransactionDocument,
  user: { email: string },
  approvedCount: number,
): Promise<void> {
  const now = new Date();
  const expiry = new Date(now.getTime() + MEMBERSHIP_DURATION_MS);
  await deps.usersService.activateMembership(
    transaction.userId,
    now,
    expiry,
    "installments",
  );
  deps.logger.log(
    `Membership activated (12 installments complete): user=${maskUserId(transaction.userId)} expiry=${expiry.toISOString()}`,
  );

  await deps.notificationsService.create({
    userId: transaction.userId,
    type: NotificationType.MEMBERSHIP_ACTIVATED,
    title: "Membresía Legend activada",
    message: `Completaste las 12 cuotas. Tu membresía Legend está activa hasta el ${expiry.toLocaleDateString("es-CO")}. ¡Bienvenido al ecosistema BSK!`,
    priority: NotificationPriority.HIGH,
    metadata: {
      paymentPlan: "installment",
      installmentsPaid: approvedCount,
      newExpiry: expiry.toISOString(),
    },
    relatedReference: transaction.reference,
    notifyCategory: "Membresia y pagos",
  });
}
