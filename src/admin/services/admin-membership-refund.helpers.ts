import { BadRequestException, NotFoundException, Logger } from "@nestjs/common";
import { Model } from "mongoose";
import {
  ServiceCreditTransactionDocument,
  CreditTransactionType,
  CreditSource,
} from "../../membership/schemas/service-credit-transaction.schema";
import { UserDocument, CreditType } from "../../users/schemas/user.schema";
import { NotificationsService } from "../../notifications/notifications.service";
import {
  NotificationType,
  NotificationPriority,
} from "../../notifications/schemas/notification.schema";

export async function executeApproveRefund(
  userModel: Model<UserDocument>,
  creditTransactionModel: Model<ServiceCreditTransactionDocument>,
  notificationsService: NotificationsService,
  userId: string,
  actorId = "",
  logger?: Logger,
) {
  const updated = await userModel.findOneAndUpdate(
    {
      _id: userId,
      "partialPaymentCredit.type": CreditType.REFUND_REQUESTED,
    },
    {
      $set: {
        "partialPaymentCredit.type": CreditType.REFUNDED,
        "partialPaymentCredit.notes": "Reembolso aprobado por admin",
      },
    },
    { new: true },
  );
  if (!updated) {
    const user = await userModel.findById(userId);
    if (!user) throw new NotFoundException("Usuario no encontrado");
    throw new BadRequestException(
      "El reembolso ya fue procesado o el crédito no está pendiente",
    );
  }

  const credit = updated.partialPaymentCredit!;
  const timestamp = Date.now();
  const shortUserId = userId.slice(-8);
  const reference = `REF-APR-${shortUserId}-${timestamp}`;

  await creditTransactionModel.create({
    userId,
    reference,
    transactionType: CreditTransactionType.CREDIT_REFUNDED,
    creditSource: CreditSource.MEMBERSHIP,
    amount: credit.amount,
    description: `Reembolso aprobado por administración (${credit.installmentsPaid} cuotas)`,
    metadata: {
      adminAction: true,
      installmentsPaid: credit.installmentsPaid,
      originalCreditAmount: credit.amount,
      status: "approved-by-admin",
    },
  });

  await userModel.updateOne(
    { _id: userId },
    {
      "partialPaymentCredit.notes": `Reembolso aprobado por admin. Ref: ${reference}`,
    },
  );

  await notificationsService.create({
    userId,
    type: NotificationType.MEMBERSHIP_PAYMENT_REJECTED,
    title: "Reembolso aprobado",
    message: `Tu solicitud de reembolso fue aprobada. Monto: ${credit.amount.toLocaleString("es-CO")} COP. Ref: ${reference}.`,
    priority: NotificationPriority.HIGH,
    metadata: {
      adminAction: true,
      reference,
      amount: credit.amount,
    },
  });

  logger?.log(
    `Refund admin-approved: user=${userId} amount=*** ref=${reference} actor=${actorId}`,
  );
  return {
    success: true,
    reference,
    amount: credit.amount,
    status: "approved",
  };
}

export async function executeRejectRefund(
  userModel: Model<UserDocument>,
  creditTransactionModel: Model<ServiceCreditTransactionDocument>,
  notificationsService: NotificationsService,
  userId: string,
  reason?: string,
  actorId = "",
  logger?: Logger,
) {
  const user = await userModel.findById(userId);
  if (!user) {
    throw new NotFoundException("Usuario no encontrado");
  }
  const credit = user.partialPaymentCredit;
  if (credit?.type !== CreditType.REFUND_REQUESTED) {
    throw new BadRequestException(
      "El usuario no tiene una solicitud de reembolso pendiente",
    );
  }

  await userModel.updateOne(
    { _id: userId },
    {
      partialPaymentCredit: {
        ...credit,
        type: CreditType.MEMBERSHIP,
        refundRequestedAt: null,
        notes: `Reembolso rechazado por admin. Crédito convertido a membresía. Motivo: ${reason ?? "sin motivo"}`,
      },
    },
  );

  const timestamp = Date.now();
  const shortUserId = userId.slice(-8);
  const reference = `REF-REJ-${shortUserId}-${timestamp}`;
  await creditTransactionModel.create({
    userId,
    reference,
    transactionType: CreditTransactionType.CREDIT_CONVERTED_TO_MEMBERSHIP,
    creditSource: CreditSource.MEMBERSHIP,
    amount: credit.amount,
    description: `Reembolso rechazado por admin — crédito revertido a membresía. Motivo: ${reason ?? "sin motivo"}`,
    metadata: {
      adminAction: true,
      installmentsPaid: credit.installmentsPaid,
      status: "rejected-by-admin",
      reason: reason ?? null,
    },
  });

  await notificationsService.create({
    userId,
    type: NotificationType.MEMBERSHIP_PAYMENT_REJECTED,
    title: "Solicitud de reembolso rechazada",
    message: `Tu solicitud de reembolso fue rechazada. Tu crédito se mantiene disponible para membresía/servicios. Motivo: ${reason ?? "sin motivo"}.`,
    priority: NotificationPriority.MEDIUM,
    metadata: {
      adminAction: true,
      reference,
    },
  });

  logger?.log(
    `Refund admin-rejected: user=${userId} reason=${reason ?? ""} actor=${actorId}`,
  );
  return { success: true, reference, status: "rejected" };
}
