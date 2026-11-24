import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Model } from "mongoose";
import { MembershipTransactionDocument } from "./schemas/membership-transaction.schema";
import { UsersService } from "../users/users.service";
import { NotificationsService } from "../notifications/notifications.service";
import { maskReference } from "../common/utils/log-redact.util";
import { KvCacheService } from "../kv/kv-cache.service";
import type { EnvironmentConfig } from "../config/config.interface";
import type { SecurityAuditService } from "../common/audit/security-audit.service";
import { revertCreditIfUsed } from "./membership-credit-apply.helpers";
import { sendRejectionNotification } from "./membership-sync.helpers";
import {
  canTransitionBoldStatus,
  isBoldAmountOrCurrencyMismatch,
  parseBoldWebhookJson,
  recordBoldVoidedAudit,
  verifyBoldWebhookSignatureShared,
} from "../payments/bold.helpers";

import {
  type ParsedMembershipWebhook,
  parseBoldWebhookEvent,
  mapBoldStatus,
} from "./membership-webhook-parser.helpers";

export {
  type ParsedMembershipWebhook,
  parseBoldAmount,
  parseBoldWebhookEvent,
  mapBoldStatus,
} from "./membership-webhook-parser.helpers";

export function verifyBoldWebhookSignature(
  configService: ConfigService<EnvironmentConfig>,
  logger: Logger,
  rawBody: Buffer,
  signature: string,
  auditService?: SecurityAuditService,
): void {
  verifyBoldWebhookSignatureShared(configService, logger, rawBody, signature, {
    auditService,
    path: "/api/membership/webhook",
  });
}

export function isDuplicateWebhook(
  transaction: MembershipTransactionDocument,
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
  transaction: MembershipTransactionDocument,
  event: Record<string, unknown>,
  parsed: ParsedMembershipWebhook,
): void {
  transaction.webhookEvents.push({
    notificationId: parsed.notificationId ?? "UNKNOWN",
    paymentId: parsed.paymentId ?? "UNKNOWN",
    type: parsed.eventType ?? "UNKNOWN",
    receivedAt: new Date(),
    data: event,
  });
  if (parsed.paymentId && !transaction.boldPaymentId) {
    transaction.boldPaymentId = parsed.paymentId;
  }
}

export function isAmountMismatch(
  logger: Logger,
  transaction: MembershipTransactionDocument,
  parsed: ParsedMembershipWebhook,
  statusFromEvent: string | null,
): boolean {
  if (statusFromEvent !== "APPROVED") return false;
  return isBoldAmountOrCurrencyMismatch(
    logger,
    parsed.referenceId ?? transaction.reference,
    transaction.amount,
    parsed.amount,
    parsed.currency,
    "membership webhook",
  );
}

export function applyWebhookStatusUpdate(
  logger: Logger,
  transaction: MembershipTransactionDocument,
  status: string,
  parsed: ParsedMembershipWebhook,
): boolean {
  if (!canTransitionBoldStatus(transaction.status, status)) {
    logger.warn(
      `Ignoring ${status} for ${transaction.status} membership transaction ${maskReference(transaction.reference)}`,
    );
    return false;
  }

  if (status === "APPROVED") {
    transaction.status = "APPROVED";
    transaction.paidAt = new Date();
    if (parsed.paymentMethod) transaction.paymentMethod = parsed.paymentMethod;
    if (parsed.payerEmail) transaction.payerEmail = parsed.payerEmail;
  } else {
    transaction.status = status;
  }
  return true;
}

export interface WebhookHandlerDeps {
  configService: ConfigService<EnvironmentConfig>;
  transactionModel: Model<MembershipTransactionDocument>;
  usersService: UsersService;
  notificationsService: NotificationsService;
  kvCache?: KvCacheService;
  auditService?: SecurityAuditService;
  logger: Logger;
  processApprovedPayment: (t: MembershipTransactionDocument) => Promise<void>;
}

async function isSeenInWebhookKv(
  deps: WebhookHandlerDeps,
  parsed: ParsedMembershipWebhook,
): Promise<boolean> {
  if (!parsed.notificationId || !parsed.referenceId || !deps.kvCache) {
    return false;
  }
  const kvSeen = await deps.kvCache.get<number>(
    `webhook:seen:${parsed.referenceId}:${parsed.notificationId}`,
    true,
  );
  if (kvSeen !== null) {
    deps.logger.log(
      `KV screener: duplicate membership webhook skipped: ${parsed.notificationId}, ${maskReference(parsed.referenceId)}`,
    );
    return true;
  }
  return false;
}

async function markSeenInWebhookKv(
  deps: WebhookHandlerDeps,
  parsed: ParsedMembershipWebhook,
): Promise<void> {
  if (!parsed.notificationId || !parsed.referenceId || !deps.kvCache) return;
  await deps.kvCache
    .set(
      `webhook:seen:${parsed.referenceId}:${parsed.notificationId}`,
      1,
      7 * 24 * 60 * 60,
      true,
    )
    .catch(() => {});
}

async function dispatchWebhookOutcome(
  deps: WebhookHandlerDeps,
  transaction: MembershipTransactionDocument,
  previousStatus: string,
  statusFromEvent: string | null,
  didChange: boolean,
): Promise<void> {
  if (!didChange || !statusFromEvent) return;
  if (previousStatus === "APPROVED" && statusFromEvent === "VOIDED") {
    deps.logger.warn(
      `CRITICAL FINANCIAL EVENT: Approved membership payment ${maskReference(transaction.reference)} was VOIDED by Bold webhook`,
    );
    recordBoldVoidedAudit(
      deps.auditService,
      "/api/membership/webhook",
      transaction.reference,
      transaction.amount,
      "webhook",
    );
    return;
  }
  if (statusFromEvent === "APPROVED") {
    await deps.processApprovedPayment(transaction);
    return;
  }
  if (statusFromEvent === "REJECTED" || statusFromEvent === "FAILED") {
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
      statusFromEvent,
    );
  }
}

/**
 * Processes an already signature-verified Bold webhook against `membershiptransactions`.
 * Returns `true` if a matching membership transaction was found and handled, `false` otherwise.
 */
export async function processVerifiedMembershipWebhookHelper(
  deps: WebhookHandlerDeps,
  event: Record<string, unknown>,
  parsed: ParsedMembershipWebhook,
): Promise<boolean> {
  if (!parsed.referenceId) {
    return false;
  }

  if (await isSeenInWebhookKv(deps, parsed)) {
    return true;
  }

  const transaction = await deps.transactionModel.findOne({
    reference: parsed.referenceId,
  });
  if (!transaction) {
    return false;
  }

  if (isDuplicateWebhook(transaction, parsed.notificationId)) {
    deps.logger.log(
      `Duplicate membership webhook ignored: ${parsed.notificationId ?? parsed.paymentId}, ${maskReference(parsed.referenceId)}`,
    );
    return true;
  }

  recordWebhookEvent(transaction, event, parsed);

  const statusFromEvent = mapBoldStatus(parsed.eventType);
  if (isAmountMismatch(deps.logger, transaction, parsed, statusFromEvent)) {
    await transaction.save();
    await markSeenInWebhookKv(deps, parsed);
    return true;
  }

  const previousStatus = transaction.status;
  const didChange = statusFromEvent
    ? applyWebhookStatusUpdate(
        deps.logger,
        transaction,
        statusFromEvent,
        parsed,
      )
    : false;

  await transaction.save();
  // L-05: Mark seen in KV only AFTER MongoDB persistence succeeds so transient DB errors can retry.
  await markSeenInWebhookKv(deps, parsed);
  deps.logger.log(
    `Membership webhook processed: ${parsed.eventType} for ${maskReference(parsed.referenceId)}`,
  );

  await dispatchWebhookOutcome(
    deps,
    transaction,
    previousStatus,
    statusFromEvent,
    didChange,
  );
  return true;
}

export async function handleWebhookHelper(
  deps: WebhookHandlerDeps,
  rawBody: Buffer,
  signature: string,
): Promise<void> {
  verifyBoldWebhookSignature(
    deps.configService,
    deps.logger,
    rawBody,
    signature,
    deps.auditService,
  );

  const event = parseBoldWebhookJson(rawBody);
  const parsed = parseBoldWebhookEvent(event);
  if (!parsed.referenceId) {
    deps.logger.warn("Membership webhook without reference");
    return;
  }

  const handled = await processVerifiedMembershipWebhookHelper(
    deps,
    event,
    parsed,
  );
  if (!handled) {
    deps.logger.warn(
      `Membership webhook for unknown reference: ${maskReference(parsed.referenceId)}`,
    );
  }
}
