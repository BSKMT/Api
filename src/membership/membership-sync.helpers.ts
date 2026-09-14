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
import { TERMINAL_STATUSES } from "./membership.constants";
import { parseBoldAmount } from "./membership-webhook.helpers";
import { revertCreditIfUsed } from "./membership-credit-apply.helpers";

export interface MembershipSyncDeps {
  configService: ConfigService<EnvironmentConfig>;
  transactionModel: Model<MembershipTransactionDocument>;
  usersService: UsersService;
  notificationsService: NotificationsService;
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
  switch (boldStatus.toUpperCase()) {
    case "APPROVED":
      return "APPROVED";
    case "REJECTED":
      return "REJECTED";
    case "FAILED":
      return "FAILED";
    case "VOIDED":
      return "VOIDED";
    case "PROCESSING":
      return "PROCESSING";
    case "PENDING":
    default:
      return null;
  }
}

export function isVoucherAmountMismatch(
  logger: Logger,
  transaction: MembershipTransactionDocument,
  body: Record<string, unknown>,
): boolean {
  const voucherAmount = parseBoldAmount(body["amount"]);
  if (voucherAmount === undefined) return false;
  if (transaction.amount <= 0) return false;
  if (voucherAmount === transaction.amount) return false;
  logger.warn(
    `Amount mismatch in Bold voucher sync for ref ${transaction.reference}: expected ${transaction.amount}, received ${voucherAmount}. Skipping approval.`,
  );
  return true;
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
      `Bold sync: no transaction found yet for reference: ${transaction.reference}`,
    );
    return;
  }

  const mappedStatus = mapBoldVoucherStatus(boldStatus);
  if (!mappedStatus) return;

  if (TERMINAL_STATUSES.has(transaction.status)) {
    deps.logger.warn(
      `Bold sync: ignoring ${mappedStatus} for already-${transaction.status} reference ${transaction.reference}`,
    );
    return;
  }

  if (
    mappedStatus === "APPROVED" &&
    isVoucherAmountMismatch(deps.logger, transaction, body)
  ) {
    return;
  }

  deps.logger.log(
    `Bold sync: updating ${transaction.reference} from ${transaction.status} to ${mappedStatus}`,
  );

  transaction.status = mappedStatus;

  if (mappedStatus === "APPROVED") {
    applyApprovedVoucherFields(transaction, body);
  }

  await transaction.save();

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

  const identityKey =
    deps.configService.get<string>("BOLD_IDENTITY_KEY", { infer: true }) ?? "";

  if (!identityKey) {
    deps.logger.warn(
      "Cannot sync with Bold: BOLD_IDENTITY_KEY is not configured",
    );
    return;
  }

  const boldEnv =
    deps.configService.get<string>("BOLD_ENVIRONMENT", { infer: true }) ??
    "sandbox";
  const baseUrl =
    boldEnv === "production"
      ? "https://payments.api.bold.co"
      : "https://payments-api-test.bold.co";
  const url = `${baseUrl}/v2/payment-voucher/${encodeURIComponent(transaction.reference)}`;

  transaction.lastBoldSyncAt = new Date();
  await transaction.save();

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `x-api-key ${identityKey}`,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      deps.logger.warn(
        `Bold sync API returned ${res.status} for reference: ${transaction.reference}`,
      );
      return;
    }

    const body = (await res.json()) as Record<string, unknown>;
    await applyBoldVoucherBody(deps, transaction, body);
  } catch (err: unknown) {
    deps.logger.warn(
      `Bold sync failed for ${transaction.reference}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
