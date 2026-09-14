import * as crypto from "node:crypto";
import { BadRequestException, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Model } from "mongoose";
import {
  TransactionDocument,
  WebhookEvent,
} from "./schemas/transaction.schema";
import { KvCacheService } from "../kv/kv-cache.service";
import type { EnvironmentConfig } from "../config/config.interface";
import { TERMINAL_STATUSES } from "./payments.constants";

export interface ParsedBoldWebhookEvent {
  notificationId: string | undefined;
  eventType: string | undefined;
  paymentId: string | undefined;
  referenceId: string | undefined;
  paymentMethod: string | undefined;
  payerEmail: string | undefined;
  amount: number | undefined;
}

export function parseBoldAmount(raw: unknown): number | undefined {
  if (typeof raw === "number") return raw;
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const total = obj["total"];
    if (typeof total === "number") return total;
    const amount = obj["amount"];
    if (typeof amount === "number") return amount;
  }
  return undefined;
}

export function parseBoldWebhookEvent(
  event: Record<string, unknown>,
): ParsedBoldWebhookEvent {
  const notificationId = event["id"] as string | undefined;
  const eventType = event["type"] as string | undefined;
  const data = (event["data"] ?? {}) as Record<string, unknown>;
  const metadata = (data["metadata"] ?? {}) as Record<string, unknown>;
  return {
    notificationId,
    eventType,
    paymentId: data["payment_id"] as string | undefined,
    referenceId: metadata["reference"] as string | undefined,
    paymentMethod: data["payment_method"] as string | undefined,
    payerEmail: data["payer_email"] as string | undefined,
    amount: parseBoldAmount(data["amount"]),
  };
}

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
    logger.warn("Invalid webhook signature received");
    throw new BadRequestException("Invalid signature");
  }
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
  switch (eventType) {
    case "SALE_APPROVED":
    case "PAYMENT_APPROVED":
      return "APPROVED";
    case "SALE_REJECTED":
    case "PAYMENT_REJECTED":
      return "REJECTED";
    case "VOID_APPROVED":
    case "PAYMENT_VOIDED":
      return "VOIDED";
    case "VOID_REJECTED":
    case "PAYMENT_FAILED":
      return "FAILED";
    case "PAYMENT_PROCESSING":
      return "PROCESSING";
    default:
      return null;
  }
}

export function isAmountMismatch(
  logger: Logger,
  transaction: TransactionDocument,
  parsed: ParsedBoldWebhookEvent,
  statusFromEvent: string | null,
): boolean {
  if (statusFromEvent !== "APPROVED") return false;
  if (parsed.amount === undefined) return false;
  if (transaction.amount <= 0) return false;
  if (parsed.amount === transaction.amount) return false;

  logger.warn(
    `Amount mismatch in webhook for reference ${parsed.referenceId}: expected ${transaction.amount}, received ${parsed.amount}. Skipping approval.`,
  );
  return true;
}

export function applyWebhookStatusUpdate(
  logger: Logger,
  transaction: TransactionDocument,
  parsed: ParsedBoldWebhookEvent,
  statusFromEvent: string | null,
): boolean {
  if (!statusFromEvent) {
    logger.log(
      `Unhandled webhook event type: ${parsed.eventType} for reference: ${parsed.referenceId}`,
    );
    return false;
  }

  // C-2: Block ALL transitions from a terminal status
  if (TERMINAL_STATUSES.has(transaction.status)) {
    logger.warn(
      `Ignoring ${statusFromEvent} for already-${transaction.status} transaction ${parsed.referenceId}`,
    );
    return false;
  }

  transaction.status = statusFromEvent;
  if (statusFromEvent !== "APPROVED") return true;

  if (parsed.paymentMethod) transaction.paymentMethod = parsed.paymentMethod;
  if (parsed.payerEmail) transaction.payerEmail = parsed.payerEmail;
  return true;
}

export async function findWebhookTransaction(
  deps: {
    kvCache: KvCacheService;
    transactionModel: Model<TransactionDocument>;
    logger: Logger;
  },
  parsed: ParsedBoldWebhookEvent,
): Promise<TransactionDocument | null> {
  if (!parsed.referenceId) {
    deps.logger.warn("Webhook received without reference");
    return null;
  }

  if (parsed.notificationId) {
    const kvSeen = await deps.kvCache.get<number>(
      `webhook:seen:${parsed.referenceId}:${parsed.notificationId}`,
      true,
    );
    if (kvSeen !== null) {
      deps.logger.log(
        `KV screener: duplicate webhook skipped: ${parsed.notificationId}, ${parsed.referenceId}`,
      );
      return null;
    }
  }

  const transaction = await deps.transactionModel.findOne({
    reference: parsed.referenceId,
  });
  if (!transaction) {
    deps.logger.warn(
      `Webhook received for unknown reference: ${parsed.referenceId}`,
    );
    return null;
  }

  if (isDuplicateWebhook(transaction, parsed.notificationId)) {
    deps.logger.log(
      `Duplicate webhook ignored: ${parsed.notificationId ?? parsed.paymentId}, ${parsed.referenceId}`,
    );
    return null;
  }

  if (parsed.notificationId) {
    await deps.kvCache.set(
      `webhook:seen:${parsed.referenceId}:${parsed.notificationId}`,
      1,
      7 * 24 * 60 * 60,
      true,
    );
  }

  // PAY-16: If notificationId is missing, use paymentId as fallback dedup
  if (parsed.notificationId === undefined && parsed.paymentId) {
    const seenByPaymentId = transaction.webhookEvents.some(
      (e) =>
        typeof e["paymentId"] === "string" &&
        e["paymentId"] === parsed.paymentId,
    );
    if (seenByPaymentId) {
      deps.logger.log(
        `Duplicate webhook (by paymentId) ignored: ${parsed.paymentId}, ${parsed.referenceId}`,
      );
      return null;
    }
  }

  return transaction;
}
