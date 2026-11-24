import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Model } from "mongoose";
import {
  TransactionDocument,
  WebhookEvent,
} from "./schemas/transaction.schema";
import { KvCacheService } from "../kv/kv-cache.service";
import type { EnvironmentConfig } from "../config/config.interface";
import type { SecurityAuditService } from "../common/audit/security-audit.service";
import { maskReference } from "../common/utils/log-redact.util";
import {
  type ParsedBoldWebhookPayload,
  parseBoldAmount,
  parseBoldWebhookPayload,
  verifyBoldWebhookSignatureShared,
  mapBoldWebhookStatus,
  canTransitionBoldStatus,
  isBoldAmountOrCurrencyMismatch,
} from "./bold.helpers";

export type ParsedBoldWebhookEvent = ParsedBoldWebhookPayload;

export { parseBoldAmount };

export function parseBoldWebhookEvent(
  event: Record<string, unknown>,
): ParsedBoldWebhookEvent {
  return parseBoldWebhookPayload(event);
}

export function verifyBoldWebhookSignature(
  configService: ConfigService<EnvironmentConfig>,
  logger: Logger,
  rawBody: Buffer,
  signature: string,
  auditService?: SecurityAuditService,
): void {
  verifyBoldWebhookSignatureShared(configService, logger, rawBody, signature, {
    auditService,
    path: "/api/payments/webhook",
  });
}

export function isDuplicateWebhook(
  transaction: TransactionDocument,
  notificationId: string | undefined,
): boolean {
  if (notificationId === undefined) return false;
  return transaction.webhookEvents.some(
    (e) =>
      typeof e["notificationId"] === "string" &&
      e["notificationId"] === notificationId,
  );
}

export function recordWebhookEvent(
  transaction: TransactionDocument,
  event: Record<string, unknown>,
  parsed: ParsedBoldWebhookEvent,
): void {
  const webhookEvent = new WebhookEvent();
  webhookEvent.notificationId = parsed.notificationId ?? "UNKNOWN";
  webhookEvent.paymentId = parsed.paymentId ?? "UNKNOWN";
  webhookEvent.type = parsed.eventType ?? "UNKNOWN";
  webhookEvent.receivedAt = new Date();
  webhookEvent.data = event;
  transaction.webhookEvents.push(webhookEvent);
  if (parsed.paymentId && !transaction.boldPaymentId) {
    transaction.boldPaymentId = parsed.paymentId;
  }
}

export function mapBoldStatus(eventType: string | undefined): string | null {
  return mapBoldWebhookStatus(eventType);
}

export function isAmountMismatch(
  logger: Logger,
  transaction: TransactionDocument,
  parsed: ParsedBoldWebhookEvent,
  statusFromEvent: string | null,
): boolean {
  if (statusFromEvent !== "APPROVED") return false;
  return isBoldAmountOrCurrencyMismatch(
    logger,
    parsed.referenceId ?? transaction.reference,
    transaction.amount,
    parsed.amount,
    parsed.currency,
    "webhook",
  );
}

export function applyWebhookStatusUpdate(
  logger: Logger,
  transaction: TransactionDocument,
  parsed: ParsedBoldWebhookEvent,
  statusFromEvent: string | null,
): boolean {
  if (!statusFromEvent) {
    logger.log(
      `Audit-only or unhandled webhook event type: ${parsed.eventType} for ref ${maskReference(parsed.referenceId ?? transaction.reference)}`,
    );
    return false;
  }

  if (!canTransitionBoldStatus(transaction.status, statusFromEvent)) {
    logger.warn(
      `Ignoring ${statusFromEvent} for ${transaction.status} transaction ${maskReference(parsed.referenceId ?? transaction.reference)}`,
    );
    return false;
  }

  transaction.status = statusFromEvent;
  if (statusFromEvent !== "APPROVED") return true;

  if (parsed.paymentMethod) transaction.paymentMethod = parsed.paymentMethod;
  if (parsed.payerEmail) transaction.payerEmail = parsed.payerEmail;
  return true;
}

export interface FindWebhookTransactionResult {
  status: "found" | "not_found" | "duplicate" | "missing_reference";
  transaction?: TransactionDocument;
}

export async function findWebhookTransactionDetailed(
  deps: {
    kvCache: KvCacheService;
    transactionModel: Model<TransactionDocument>;
    logger: Logger;
  },
  parsed: ParsedBoldWebhookEvent,
): Promise<FindWebhookTransactionResult> {
  if (!parsed.referenceId) {
    deps.logger.warn("Webhook received without reference");
    return { status: "missing_reference" };
  }

  if (parsed.notificationId) {
    const kvSeen = await deps.kvCache.get<number>(
      `webhook:seen:${parsed.referenceId}:${parsed.notificationId}`,
      true,
    );
    if (kvSeen !== null) {
      deps.logger.log(
        `KV screener: duplicate webhook skipped: ${parsed.notificationId}, ${maskReference(parsed.referenceId)}`,
      );
      return { status: "duplicate" };
    }
  }

  const transaction = await deps.transactionModel.findOne({
    reference: parsed.referenceId,
  });
  if (!transaction) {
    return { status: "not_found" };
  }

  if (isDuplicateWebhook(transaction, parsed.notificationId)) {
    deps.logger.log(
      `Duplicate webhook ignored: ${parsed.notificationId ?? parsed.paymentId}, ${maskReference(parsed.referenceId)}`,
    );
    return { status: "duplicate" };
  }

  if (parsed.notificationId === undefined && parsed.paymentId) {
    const seenByPaymentId = transaction.webhookEvents.some(
      (e) =>
        typeof e["paymentId"] === "string" &&
        e["paymentId"] === parsed.paymentId,
    );
    if (seenByPaymentId) {
      deps.logger.log(
        `Duplicate webhook (by paymentId) ignored: ${parsed.paymentId}, ${maskReference(parsed.referenceId)}`,
      );
      return { status: "duplicate" };
    }
  }

  return { status: "found", transaction };
}

export async function findWebhookTransaction(
  deps: {
    kvCache: KvCacheService;
    transactionModel: Model<TransactionDocument>;
    logger: Logger;
  },
  parsed: ParsedBoldWebhookEvent,
): Promise<TransactionDocument | null> {
  const result = await findWebhookTransactionDetailed(deps, parsed);
  if (result.status === "not_found" && parsed.referenceId) {
    deps.logger.warn(
      `Webhook received for unknown reference: ${maskReference(parsed.referenceId)}`,
    );
  }
  return result.transaction ?? null;
}

export async function markPaymentWebhookSeen(
  kvCache: KvCacheService,
  parsed: ParsedBoldWebhookEvent,
): Promise<void> {
  if (!parsed.notificationId || !parsed.referenceId) return;
  await kvCache
    .set(
      `webhook:seen:${parsed.referenceId}:${parsed.notificationId}`,
      1,
      7 * 24 * 60 * 60,
      true,
    )
    .catch(() => {});
}
