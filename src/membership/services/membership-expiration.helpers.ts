import { Logger } from "@nestjs/common";
import { Model } from "mongoose";
import { UserDocument, UserRole } from "../../users/schemas/user.schema";
import { INSTALLMENT_AMOUNT } from "../membership.constants";
import type { NotificationsService } from "../../notifications/notifications.service";
import {
  NotificationType,
  NotificationPriority,
} from "../../notifications/schemas/notification.schema";

export async function executeRevokeWithoutCredit(
  userModel: Model<UserDocument>,
  notificationsService: NotificationsService,
  member: UserDocument,
  now: Date,
  logger: Logger,
): Promise<void> {
  const updateResult = await userModel.findOneAndUpdate(
    {
      _id: member._id,
      membershipExpired: false,
      membershipGracePeriodEnd: { $lt: now },
    },
    {
      role: UserRole.USER,
      membershipLevel: null,
      membershipStartDate: null,
      membershipExpiryDate: null,
      membershipPaymentPlan: null,
      installmentsPaid: 0,
      membershipGracePeriodEnd: null,
      membershipExpired: true,
      renewalInstallmentsPaid: 0,
    },
    { new: true },
  );
  if (!updateResult) {
    logger.log(
      `Skipping expiration for ${String(member._id)} — membership was renewed between find and update.`,
    );
    return;
  }

  logger.log(
    `User ${String(member._id)} reverted to user role after grace period expiration`,
  );

  await notificationsService.create({
    userId: String(member._id),
    type: NotificationType.MEMBERSHIP_REVOKED,
    title: "Membresía revocada",
    message:
      "Tu periodo de gracia finalizó y tu membresía Legend fue revocada. Puedes adquirir una nueva membresía cuando lo desees.",
    priority: NotificationPriority.HIGH,
    notifyCategory: "Membresia y pagos",
  });
}

export async function executeRevokeWithPartialCredit(
  userModel: Model<UserDocument>,
  notificationsService: NotificationsService,
  member: UserDocument,
  now: Date,
  partialRenewalCount: number,
  logger: Logger,
): Promise<void> {
  const creditAmount = partialRenewalCount * INSTALLMENT_AMOUNT;

  if (member.partialPaymentCredit) {
    logger.warn(
      `Skipping credit grant for ${String(member._id)}: a credit already exists (${(member.partialPaymentCredit as { amount: number }).amount} COP, type ${(member.partialPaymentCredit as { type?: string }).type}). Manual reconciliation required.`,
    );
    await executeRevokeWithoutCredit(
      userModel,
      notificationsService,
      member,
      now,
      logger,
    );
    return;
  }

  const updateResult = await userModel.findOneAndUpdate(
    {
      _id: member._id,
      membershipExpired: false,
      membershipGracePeriodEnd: { $lt: now },
      partialPaymentCredit: null,
    },
    {
      role: UserRole.USER,
      membershipLevel: null,
      membershipStartDate: null,
      membershipExpiryDate: null,
      membershipPaymentPlan: null,
      installmentsPaid: 0,
      membershipGracePeriodEnd: null,
      membershipExpired: true,
      renewalInstallmentsPaid: 0,
      partialPaymentCredit: {
        amount: creditAmount,
        installmentsPaid: partialRenewalCount,
        originalCurrency: "COP",
        createdAt: now,
        type: "pending",
        usedAmount: 0,
        expiresAt: null,
        refundRequestedAt: null,
        convertedAt: null,
        notes: `Crédito generado por ${partialRenewalCount} cuotas de renovación no completadas. El usuario debe elegir: crédito para membresía, crédito para servicios, o reembolso.`,
      },
    },
    { new: true },
  );
  if (!updateResult) {
    logger.log(
      `Skipping expiration for ${String(member._id)} — membership was renewed between find and update, or a credit was set concurrently.`,
    );
    return;
  }

  logger.log(
    `User ${String(member._id)} reverted to user role. ${partialRenewalCount} renewal installments converted to pending credit (${creditAmount} COP). User must choose: membership credit, service credit, or refund.`,
  );

  await notificationsService.create({
    userId: String(member._id),
    type: NotificationType.MEMBERSHIP_REVOKED,
    title: "Membresía revocada",
    message: `Tu membresía Legend fue revocada. Convertimos tus ${partialRenewalCount} cuotas de renovación en un crédito de ${creditAmount.toLocaleString("es-CO")} COP. Elige qué hacer con él desde tu panel de membresía.`,
    priority: NotificationPriority.HIGH,
    metadata: {
      creditAmount,
      partialRenewalCount,
    },
    notifyCategory: "Membresia y pagos",
  });
}
