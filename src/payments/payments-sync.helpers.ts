import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Model } from "mongoose";
import { TransactionDocument } from "./schemas/transaction.schema";
import type { EnvironmentConfig } from "../config/config.interface";
import { TERMINAL_STATUSES } from "./payments.constants";
import { parseBoldAmount } from "./payments-webhook.helpers";

export interface BoldSyncDeps {
  configService: ConfigService<EnvironmentConfig>;
  transactionModel: Model<TransactionDocument>;
  logger: Logger;
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
  transaction: TransactionDocument,
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
      `Bold sync: no transaction found yet for reference: ${transaction.reference}`,
    );
    return;
  }

  const mappedStatus = mapBoldVoucherStatus(boldStatus);
  if (!mappedStatus) {
    return;
  }

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
