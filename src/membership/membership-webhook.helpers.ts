import * as crypto from "node:crypto";
import { BadRequestException, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Model } from "mongoose";
import { MembershipTransactionDocument } from "./schemas/membership-transaction.schema";
import { UsersService } from "../users/users.service";
import { NotificationsService } from "../notifications/notifications.service";
import { maskReference } from "../common/utils/log-redact.util";
import type { EnvironmentConfig } from "../config/config.interface";
import { TERMINAL_STATUSES } from "./membership.constants";
import { revertCreditIfUsed } from "./membership-credit-apply.helpers";
import { sendRejectionNotification } from "./membership-sync.helpers";

export interface ParsedMembershipWebhook {
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
): ParsedMembershipWebhook {
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
    default:
      return null;
  }
}

export function isAmountMismatch(
  transaction: MembershipTransactionDocument,
  parsed: ParsedMembershipWebhook,
  statusFromEvent: string | null,
): boolean {
  if (statusFromEvent !== "APPROVED") return false;
  if (parsed.amount === undefined) return false;
  if (transaction.amount <= 0) return false;
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
  logger: Logger;
  processApprovedPayment: (t: MembershipTransactionDocument) => Promise<void>;
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

  const transaction = await deps.transactionModel.findOne({
    reference: parsed.referenceId,
  });
  if (!transaction) {
    deps.logger.warn(
      `Membership webhook for unknown reference: ${maskReference(parsed.referenceId ?? "")}`,
    );
    return;
  }

  if (isDuplicateWebhook(transaction, parsed.notificationId)) {
    deps.logger.log(
      `Duplicate membership webhook ignored: ${parsed.notificationId ?? parsed.paymentId}, ${parsed.referenceId}`,
    );
    return;
  }

  recordWebhookEvent(transaction, event, parsed);

  const statusFromEvent = mapBoldStatus(parsed.eventType);
  if (
    statusFromEvent === "APPROVED" &&
    isAmountMismatch(transaction, parsed, statusFromEvent)
  ) {
    deps.logger.warn(
      `Amount mismatch in membership webhook for ref ${maskReference(parsed.referenceId ?? "")}: expected ${transaction.amount}, received ${parsed.amount}. Skipping approval.`,
    );
    await transaction.save();
    return;
  }

  let didChange = false;
  if (statusFromEvent) {
    didChange = applyWebhookStatusUpdate(
      deps.logger,
      transaction,
      statusFromEvent,
      parsed,
    );
  }

  await transaction.save();
  deps.logger.log(
    `Membership webhook processed: ${parsed.eventType} for ${maskReference(parsed.referenceId ?? "")}`,
  );

  if (didChange && statusFromEvent === "APPROVED") {
    await deps.processApprovedPayment(transaction);
  } else if (
    didChange &&
    (statusFromEvent === "REJECTED" || statusFromEvent === "FAILED")
  ) {
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
