import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Model } from "mongoose";
import { MembershipTransactionDocument } from "./schemas/membership-transaction.schema";
import { UsersService } from "../users/users.service";
import { NotificationsService } from "../notifications/notifications.service";
import {
  NotificationType,
  NotificationPriority,
} from "../notifications/schemas/notification.schema";
import type { EnvironmentConfig } from "../config/config.interface";
import type { SecurityAuditService } from "../common/audit/security-audit.service";
import { maskReference } from "../common/utils/log-redact.util";
import { revertCreditIfUsed } from "./membership-credit-apply.helpers";
import {
  canTransitionBoldStatus,
  fetchBoldPaymentVoucher,
  isBoldVoucherMismatch,
  mapBoldVoucherStatusShared,
  recordBoldVoidedAudit,
} from "../payments/bold.helpers";

export interface MembershipSyncDeps {
  configService: ConfigService<EnvironmentConfig>;
  transactionModel: Model<MembershipTransactionDocument>;
  usersService: UsersService;
  notificationsService: NotificationsService;
  auditService?: SecurityAuditService;
  logger: Logger;
  processApprovedPayment: (t: MembershipTransactionDocument) => Promise<void>;
}

export function isBoldSyncRateLimited(
  transaction: MembershipTransactionDocument,
): boolean {
  const now = new Date();
  const minIntervalMs = 10_000;
  return (
    !!transaction.lastBoldSyncAt &&
    now.getTime() - new Date(transaction.lastBoldSyncAt).getTime() <
      minIntervalMs
  );
}

export function mapBoldVoucherStatus(boldStatus: string): string | null {
  return mapBoldVoucherStatusShared(boldStatus);
}

export function isVoucherAmountMismatch(
  logger: Logger,
  transaction: MembershipTransactionDocument,
  body: Record<string, unknown>,
): boolean {
  return isBoldVoucherMismatch(
    logger,
    transaction.reference,
    transaction.amount,
    body,
  );
}

export function applyApprovedVoucherFields(
  transaction: MembershipTransactionDocument,
  body: Record<string, unknown>,
): void {
  transaction.paidAt = new Date();
  const paymentMethod = body["payment_method"] as string | undefined;
  const payerEmail = body["payer_email"] as string | undefined;
  const boldPaymentId = body["transaction_id"] as string | undefined;
  if (paymentMethod) transaction.paymentMethod = paymentMethod;
  if (payerEmail) transaction.payerEmail = payerEmail;
  if (boldPaymentId && !transaction.boldPaymentId) {
    transaction.boldPaymentId = boldPaymentId;
  }
}

export async function sendRejectionNotification(
  notificationsService: NotificationsService,
  transaction: MembershipTransactionDocument,
  mappedStatus: string,
): Promise<void> {
  const friendly =
    mappedStatus === "REJECTED"
      ? "Tu pago fue rechazado por la pasarela. Puedes intentarlo de nuevo."
      : "Ocurrió un fallo procesando tu pago. Revisa tu método de pago e intenta nuevamente.";
  await notificationsService.create({
    userId: transaction.userId,
    type: NotificationType.MEMBERSHIP_PAYMENT_REJECTED,
    title: "Pago de membresía rechazado",
    message: `${friendly} Referencia: ${transaction.reference}.`,
    priority: NotificationPriority.HIGH,
    metadata: {
      paymentPlan: transaction.paymentPlan,
      installmentNumber: transaction.installmentNumber,
      installmentTotal: transaction.installmentTotal,
      status: mappedStatus,
    },
    relatedReference: transaction.reference,
    notifyCategory: "Membresia y pagos",
  });
}

export async function applyBoldVoucherBody(
  deps: MembershipSyncDeps,
  transaction: MembershipTransactionDocument,
  body: Record<string, unknown>,
): Promise<void> {
  const boldStatus = body["payment_status"] as string | undefined;

  if (!boldStatus || boldStatus === "NO_TRANSACTION_FOUND") {
    deps.logger.log(
      `Bold sync: no transaction found yet for ref ${maskReference(transaction.reference)}`,
    );
    return;
  }

  const mappedStatus = mapBoldVoucherStatus(boldStatus);
  if (!mappedStatus) return;

  if (!canTransitionBoldStatus(transaction.status, mappedStatus)) {
    deps.logger.warn(
      `Bold sync: ignoring ${mappedStatus} for ${transaction.status} membership ref ${maskReference(transaction.reference)}`,
    );
    return;
  }

  if (
    mappedStatus === "APPROVED" &&
    isVoucherAmountMismatch(deps.logger, transaction, body)
  ) {
    return;
  }

  const previousStatus = transaction.status;
  deps.logger.log(
    `Bold sync: updating membership ${maskReference(transaction.reference)} from ${previousStatus} to ${mappedStatus}`,
  );

  transaction.status = mappedStatus;

  if (mappedStatus === "APPROVED") {
    applyApprovedVoucherFields(transaction, body);
  }

  await transaction.save();

  if (previousStatus === "APPROVED" && mappedStatus === "VOIDED") {
    deps.logger.warn(
      `CRITICAL FINANCIAL EVENT: Approved membership payment ${maskReference(transaction.reference)} was VOIDED in Bold voucher sync`,
    );
    recordBoldVoidedAudit(
      deps.auditService,
      "/api/membership/payment",
      transaction.reference,
      transaction.amount,
      "voucher_sync",
    );
    return;
  }

  if (mappedStatus === "APPROVED") {
    await deps.processApprovedPayment(transaction);
  } else if (mappedStatus === "REJECTED" || mappedStatus === "FAILED") {
    await revertCreditIfUsed(
      {
        usersService: deps.usersService,
        transactionModel: deps.transactionModel,
        logger: deps.logger,
      },
      transaction,
    );
    await sendRejectionNotification(
      deps.notificationsService,
      transaction,
      mappedStatus,
    );
  }
}

export async function syncWithBold(
  deps: MembershipSyncDeps,
  transaction: MembershipTransactionDocument,
): Promise<void> {
  if (isBoldSyncRateLimited(transaction)) {
    return;
  }

  transaction.lastBoldSyncAt = new Date();
  await transaction.save();

  const voucherResult = await fetchBoldPaymentVoucher(
    deps.configService,
    deps.logger,
    transaction.reference,
  );
  if (!voucherResult.ok || !voucherResult.body) {
    return;
  }

  await applyBoldVoucherBody(deps, transaction, voucherResult.body);
}
