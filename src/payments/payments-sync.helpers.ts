import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Model } from "mongoose";
import { TransactionDocument } from "./schemas/transaction.schema";
import type { EnvironmentConfig } from "../config/config.interface";
import type { KvCacheService } from "../kv/kv-cache.service";
import type { SecurityAuditService } from "../common/audit/security-audit.service";
import { maskReference } from "../common/utils/log-redact.util";
import {
  canTransitionBoldStatus,
  fetchBoldPaymentVoucher,
  isBoldVoucherMismatch,
  mapBoldVoucherStatusShared,
  recordBoldVoidedAudit,
} from "./bold.helpers";

export interface BoldSyncDeps {
  configService: ConfigService<EnvironmentConfig>;
  transactionModel: Model<TransactionDocument>;
  logger: Logger;
  kvCache?: KvCacheService;
  auditService?: SecurityAuditService;
  linkPaymentByPurpose: (transaction: TransactionDocument) => Promise<void>;
  processAlegraInvoicing: (transaction: TransactionDocument) => Promise<void>;
}

export function isBoldSyncRateLimited(
  transaction: TransactionDocument,
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
  transaction: TransactionDocument,
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
  transaction: TransactionDocument,
  body: Record<string, unknown>,
): void {
  const paymentMethod = body["payment_method"] as string | undefined;
  const payerEmail = body["payer_email"] as string | undefined;
  const boldPaymentId = body["transaction_id"] as string | undefined;
  if (paymentMethod) transaction.paymentMethod = paymentMethod;
  if (payerEmail) transaction.payerEmail = payerEmail;
  if (boldPaymentId && !transaction.boldPaymentId) {
    transaction.boldPaymentId = boldPaymentId;
  }
}

export async function grantSyncBenefit(
  deps: BoldSyncDeps,
  transaction: TransactionDocument,
): Promise<void> {
  if (transaction.benefitGranted) {
    await deps.linkPaymentByPurpose(transaction);
    return;
  }
  const claim = await deps.transactionModel.updateOne(
    { _id: transaction._id, benefitGranted: false },
    { $set: { benefitGranted: true } },
  );
  if (claim.modifiedCount === 0) {
    return;
  }
  transaction.benefitGranted = true;
  await deps.linkPaymentByPurpose(transaction);
  await deps.processAlegraInvoicing(transaction);
}

export async function applyBoldVoucherBody(
  deps: BoldSyncDeps,
  transaction: TransactionDocument,
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
  if (!mappedStatus) {
    return;
  }

  if (!canTransitionBoldStatus(transaction.status, mappedStatus)) {
    deps.logger.warn(
      `Bold sync: ignoring ${mappedStatus} for ${transaction.status} ref ${maskReference(transaction.reference)}`,
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
    `Bold sync: updating ${maskReference(transaction.reference)} from ${previousStatus} to ${mappedStatus}`,
  );

  transaction.status = mappedStatus;

  if (mappedStatus === "APPROVED") {
    applyApprovedVoucherFields(transaction, body);
  }

  await transaction.save();

  if (deps.kvCache) {
    await deps.kvCache
      .delete(`pay:status:${transaction.userId}:${transaction.reference}`, true)
      .catch(() => {});
  }

  if (previousStatus === "APPROVED" && mappedStatus === "VOIDED") {
    deps.logger.warn(
      `CRITICAL FINANCIAL EVENT: Approved payment ${maskReference(transaction.reference)} was VOIDED in Bold voucher sync`,
    );
    recordBoldVoidedAudit(
      deps.auditService,
      "/api/payments/status",
      transaction.reference,
      transaction.amount,
      "voucher_sync",
    );
  }

  if (mappedStatus === "APPROVED") {
    await grantSyncBenefit(deps, transaction);
  }
}

export async function syncWithBoldHelper(
  deps: BoldSyncDeps,
  transaction: TransactionDocument,
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
