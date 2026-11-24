import { Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Model } from "mongoose";
import { TransactionDocument } from "./schemas/transaction.schema";
import { KvCacheService } from "../kv/kv-cache.service";
import type { EnvironmentConfig } from "../config/config.interface";
import type { SecurityAuditService } from "../common/audit/security-audit.service";
import { maskReference } from "../common/utils/log-redact.util";
import { TERMINAL_STATUSES } from "./payments.constants";
import { buildBoldConfigFor } from "./payments-creation.helpers";
import {
  type ParsedBoldWebhookEvent,
  verifyBoldWebhookSignature,
  parseBoldWebhookEvent,
  findWebhookTransactionDetailed,
  markPaymentWebhookSeen,
  recordWebhookEvent,
  mapBoldStatus,
  isAmountMismatch,
  applyWebhookStatusUpdate,
} from "./payments-webhook.helpers";
import { syncWithBoldHelper } from "./payments-sync.helpers";
import { parseBoldWebhookJson, recordBoldVoidedAudit } from "./bold.helpers";

export interface PaymentStatusDeps {
  transactionModel: Model<TransactionDocument>;
  configService: ConfigService<EnvironmentConfig>;
  kvCache: KvCacheService;
  logger: Logger;
  auditService?: SecurityAuditService;
  linkPaymentByPurpose: (transaction: TransactionDocument) => Promise<void>;
  processAlegraInvoicing: (transaction: TransactionDocument) => Promise<void>;
  delegateMembershipWebhook?: (
    event: Record<string, unknown>,
    parsed: ParsedBoldWebhookEvent,
  ) => Promise<boolean>;
  getMembershipPayment?: (
    userId: string,
    reference: string,
  ) => Promise<Record<string, unknown>>;
}

interface CachedTransactionReceipt {
  reference: string;
  status: string;
  amount: number;
  description: string;
  tier: string;
  purpose: string;
  boldPaymentId: string | null;
  paymentMethod: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  requiresPayment: false;
}

function isCompleteCachedReceipt(
  cached: unknown,
): cached is CachedTransactionReceipt {
  if (!cached || typeof cached !== "object") return false;
  const obj = cached as Record<string, unknown>;
  return (
    typeof obj["status"] === "string" &&
    TERMINAL_STATUSES.has(obj["status"]) &&
    typeof obj["amount"] === "number" &&
    typeof obj["purpose"] === "string" &&
    obj["purpose"].length > 0 &&
    typeof obj["description"] === "string"
  );
}

async function handleNotFoundWebhook(
  deps: PaymentStatusDeps,
  event: Record<string, unknown>,
  parsed: ParsedBoldWebhookEvent,
): Promise<void> {
  if (deps.delegateMembershipWebhook) {
    const handledByMembership = await deps.delegateMembershipWebhook(
      event,
      parsed,
    );
    if (handledByMembership) {
      return;
    }
  }
  deps.logger.warn(
    `Webhook received for unknown reference: ${maskReference(parsed.referenceId ?? "UNKNOWN")}`,
  );
}

async function applyPostStatusChangeEffects(
  deps: PaymentStatusDeps,
  transaction: TransactionDocument,
  previousStatus: string,
  statusFromEvent: string | null,
): Promise<void> {
  if (previousStatus === "APPROVED" && statusFromEvent === "VOIDED") {
    deps.logger.warn(
      `CRITICAL FINANCIAL EVENT: Approved payment ${maskReference(transaction.reference)} was VOIDED by Bold webhook`,
    );
    recordBoldVoidedAudit(
      deps.auditService,
      "/api/payments/webhook",
      transaction.reference,
      transaction.amount,
      "webhook",
    );
    return;
  }

  if (statusFromEvent !== "APPROVED") {
    return;
  }

  if (!transaction.benefitGranted) {
    const claim = await deps.transactionModel.updateOne(
      { _id: transaction._id, benefitGranted: false },
      { $set: { benefitGranted: true } },
    );
    if (claim.modifiedCount === 0) {
      return;
    }
    transaction.benefitGranted = true;
  }
  await deps.linkPaymentByPurpose(transaction);
  await deps.processAlegraInvoicing(transaction);
}

export async function handleWebhookHelper(
  deps: PaymentStatusDeps,
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

  const lookup = await findWebhookTransactionDetailed(
    {
      kvCache: deps.kvCache,
      transactionModel: deps.transactionModel,
      logger: deps.logger,
    },
    parsed,
  );

  if (lookup.status === "not_found") {
    await handleNotFoundWebhook(deps, event, parsed);
    return;
  }

  if (lookup.status !== "found" || !lookup.transaction) {
    return;
  }

  const transaction = lookup.transaction;
  recordWebhookEvent(transaction, event, parsed);

  const statusFromEvent = mapBoldStatus(parsed.eventType);
  if (isAmountMismatch(deps.logger, transaction, parsed, statusFromEvent)) {
    await transaction.save();
    await markPaymentWebhookSeen(deps.kvCache, parsed);
    return;
  }

  const previousStatus = transaction.status;
  const didChange = applyWebhookStatusUpdate(
    deps.logger,
    transaction,
    parsed,
    statusFromEvent,
  );
  await transaction.save();
  // L-05: Mark webhook seen in KV only AFTER DB persistence succeeds.
  await markPaymentWebhookSeen(deps.kvCache, parsed);

  if (didChange) {
    await deps.kvCache
      .delete(`pay:status:${transaction.userId}:${transaction.reference}`, true)
      .catch(() => {});
  }

  deps.logger.log(
    `Webhook processed: ${parsed.eventType} for ref ${maskReference(parsed.referenceId ?? transaction.reference)}`,
  );

  if (didChange) {
    await applyPostStatusChangeEffects(
      deps,
      transaction,
      previousStatus,
      statusFromEvent,
    );
  }
}

export async function getTransactionStatusHelper(
  deps: PaymentStatusDeps,
  userId: string,
  reference: string,
): Promise<Record<string, unknown>> {
  const statusCacheKey = `pay:status:${userId}:${reference}`;
  const cached = await deps.kvCache.get<CachedTransactionReceipt>(
    statusCacheKey,
    true,
  );
  if (isCompleteCachedReceipt(cached)) {
    return {
      reference: cached.reference,
      status: cached.status,
      amount: cached.amount,
      description: cached.description,
      tier: cached.tier,
      purpose: cached.purpose,
      boldPaymentId: cached.boldPaymentId,
      paymentMethod: cached.paymentMethod,
      createdAt: cached.createdAt,
      updatedAt: cached.updatedAt,
      requiresPayment: false,
    };
  }

  const transaction = await deps.transactionModel.findOne({
    userId,
    reference,
  });
  if (!transaction) {
    if (deps.getMembershipPayment) {
      return deps.getMembershipPayment(userId, reference);
    }
    throw new NotFoundException("Transacción no encontrada");
  }

  if (
    (transaction.status === "PENDING" || transaction.status === "PROCESSING") &&
    transaction.amount > 0
  ) {
    await syncWithBoldHelper(
      {
        configService: deps.configService,
        transactionModel: deps.transactionModel,
        logger: deps.logger,
        kvCache: deps.kvCache,
        auditService: deps.auditService,
        linkPaymentByPurpose: deps.linkPaymentByPurpose,
        processAlegraInvoicing: deps.processAlegraInvoicing,
      },
      transaction,
    );
  }

  const result: Record<string, unknown> = {
    reference: transaction.reference,
    status: transaction.status,
    amount: transaction.amount,
    description: transaction.description,
    tier: transaction.tier,
    purpose: transaction.purpose,
    boldPaymentId: transaction.boldPaymentId ?? null,
    paymentMethod: transaction.paymentMethod ?? null,
    createdAt: transaction.createdAt,
    updatedAt: transaction.updatedAt,
    requiresPayment: transaction.status === "PENDING",
  };

  if (transaction.status === "PENDING" && transaction.amount > 0) {
    result.boldConfig = buildBoldConfigFor(
      deps.configService,
      transaction.reference,
      transaction.amount,
      transaction.description,
    );
  }

  if (TERMINAL_STATUSES.has(transaction.status)) {
    const receiptSnapshot: CachedTransactionReceipt = {
      reference: transaction.reference,
      status: transaction.status,
      amount: transaction.amount,
      description: transaction.description,
      tier: transaction.tier,
      purpose: transaction.purpose,
      boldPaymentId: transaction.boldPaymentId ?? null,
      paymentMethod: transaction.paymentMethod ?? null,
      createdAt: transaction.createdAt,
      updatedAt: transaction.updatedAt,
      requiresPayment: false,
    };
    await deps.kvCache
      .set(statusCacheKey, receiptSnapshot, 24 * 60 * 60, true)
      .catch(() => {});
  }

  return result;
}
