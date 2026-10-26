import * as crypto from "node:crypto";
import { BadRequestException, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Model } from "mongoose";
import { MembershipTransactionDocument } from "./schemas/membership-transaction.schema";
import { UsersService } from "../users/users.service";
import { NotificationsService } from "../notifications/notifications.service";
import { maskReference } from "../common/utils/log-redact.util";
import { KvCacheService } from "../kv/kv-cache.service";
import type { EnvironmentConfig } from "../config/config.interface";
import { TERMINAL_STATUSES } from "./membership.constants";
import { revertCreditIfUsed } from "./membership-credit-apply.helpers";
import { sendRejectionNotification } from "./membership-sync.helpers";

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
): void {
  const secretKey = configService.get<string>("BOLD_SECRET_KEY", {
    infer: true,
  });
  if (!secretKey) {
    logger.error("BOLD_SECRET_KEY not configured — rejecting webhook");
    throw new BadRequestException("Webhook secret key not configured");
  }
  const bodyBase64 = rawBody.toString("base64");
  const expectedSignature = crypto
    .createHmac("sha256", secretKey)
    .update(bodyBase64)
    .digest("hex");

  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    logger.warn("Invalid membership webhook signature");
    throw new BadRequestException("Invalid signature");
  }
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
  transaction: MembershipTransactionDocument,
  parsed: ParsedMembershipWebhook,
  statusFromEvent: string | null,
): boolean {
  if (statusFromEvent !== "APPROVED") return false;
  if (transaction.amount <= 0) return false;
  if (parsed.amount === undefined) return true;
  return parsed.amount !== transaction.amount;
}

export function applyWebhookStatusUpdate(
  logger: Logger,
  transaction: MembershipTransactionDocument,
  status: string,
  parsed: ParsedMembershipWebhook,
): boolean {
  if (TERMINAL_STATUSES.has(transaction.status)) {
    logger.warn(
      `Ignoring ${status} for already-${transaction.status} membership transaction ${transaction.reference}`,
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
  await deps.kvCache.set(
    `webhook:seen:${parsed.referenceId}:${parsed.notificationId}`,
    1,
    7 * 24 * 60 * 60,
    true,
  );
}

async function dispatchWebhookOutcome(
  deps: WebhookHandlerDeps,
  transaction: MembershipTransactionDocument,
  statusFromEvent: string | null,
  didChange: boolean,
): Promise<void> {
  if (!didChange || !statusFromEvent) return;
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
  );

  const event = JSON.parse(rawBody.toString("utf-8")) as Record<
    string,
    unknown
  >;
  const parsed = parseBoldWebhookEvent(event);
  if (!parsed.referenceId) {
    deps.logger.warn("Membership webhook without reference");
    return;
  }

  if (await isSeenInWebhookKv(deps, parsed)) {
    return;
  }

  const transaction = await deps.transactionModel.findOne({
    reference: parsed.referenceId,
  });
  if (!transaction) {
    deps.logger.warn(
      `Membership webhook for unknown reference: ${maskReference(parsed.referenceId)}`,
    );
    return;
  }

  if (isDuplicateWebhook(transaction, parsed.notificationId)) {
    deps.logger.log(
      `Duplicate membership webhook ignored: ${parsed.notificationId ?? parsed.paymentId}, ${parsed.referenceId}`,
    );
    return;
  }

  await markSeenInWebhookKv(deps, parsed);
  recordWebhookEvent(transaction, event, parsed);

  const statusFromEvent = mapBoldStatus(parsed.eventType);
  if (isAmountMismatch(transaction, parsed, statusFromEvent)) {
    deps.logger.warn(
      `Amount mismatch in membership webhook for ref ${maskReference(parsed.referenceId)}: expected ${transaction.amount}, received ${parsed.amount}. Skipping approval.`,
    );
    await transaction.save();
    return;
  }

  const didChange = statusFromEvent
    ? applyWebhookStatusUpdate(
        deps.logger,
        transaction,
        statusFromEvent,
        parsed,
      )
    : false;

  await transaction.save();
  deps.logger.log(
    `Membership webhook processed: ${parsed.eventType} for ${maskReference(parsed.referenceId)}`,
  );

  await dispatchWebhookOutcome(deps, transaction, statusFromEvent, didChange);
}
