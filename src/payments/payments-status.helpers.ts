import { Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Model } from "mongoose";
import { TransactionDocument } from "./schemas/transaction.schema";
import { KvCacheService } from "../kv/kv-cache.service";
import type { EnvironmentConfig } from "../config/config.interface";
import { TERMINAL_STATUSES } from "./payments.constants";
import { buildBoldConfigFor } from "./payments-creation.helpers";
import {
  verifyBoldWebhookSignature,
  parseBoldWebhookEvent,
  findWebhookTransaction,
  recordWebhookEvent,
  mapBoldStatus,
  isAmountMismatch,
  applyWebhookStatusUpdate,
} from "./payments-webhook.helpers";
import { syncWithBoldHelper } from "./payments-sync.helpers";

export interface PaymentStatusDeps {
  transactionModel: Model<TransactionDocument>;
  configService: ConfigService<EnvironmentConfig>;
  kvCache: KvCacheService;
  logger: Logger;
  linkPaymentByPurpose: (transaction: TransactionDocument) => Promise<void>;
  processAlegraInvoicing: (transaction: TransactionDocument) => Promise<void>;
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
  );

  const event = JSON.parse(rawBody.toString("utf-8")) as Record<
    string,
    unknown
  >;
  const parsed = parseBoldWebhookEvent(event);

  const transaction = await findWebhookTransaction(
    {
      kvCache: deps.kvCache,
      transactionModel: deps.transactionModel,
      logger: deps.logger,
    },
    parsed,
  );
  if (!transaction) return;

  recordWebhookEvent(transaction, event, parsed);

  const statusFromEvent = mapBoldStatus(parsed.eventType);
  if (isAmountMismatch(deps.logger, transaction, parsed, statusFromEvent)) {
    await transaction.save();
    return;
  }

  const didChange = applyWebhookStatusUpdate(
    deps.logger,
    transaction,
    parsed,
    statusFromEvent,
  );
  await transaction.save();
  deps.logger.log(
    `Webhook processed: ${parsed.eventType} for reference: ${parsed.referenceId}`,
  );

  if (didChange && statusFromEvent === "APPROVED") {
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
}

export async function getTransactionStatusHelper(
  deps: PaymentStatusDeps,
  userId: string,
  reference: string,
) {
  const statusCacheKey = `pay:status:${reference}`;
  const cached = await deps.kvCache.get<{
    status: string;
    requiresPayment: boolean;
  }>(statusCacheKey, true);
  if (cached && TERMINAL_STATUSES.has(cached.status)) {
    return {
      reference,
      status: cached.status,
      amount: 0,
      tier: "",
      purpose: "",
      boldPaymentId: null,
      paymentMethod: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
      requiresPayment: false,
    };
  }

  const transaction = await deps.transactionModel.findOne({
    userId,
    reference,
  });
  if (!transaction) {
    throw new NotFoundException("Transacción no encontrada");
  }

  if (transaction.status === "PENDING" && transaction.amount > 0) {
    await syncWithBoldHelper(
      {
        configService: deps.configService,
        transactionModel: deps.transactionModel,
        logger: deps.logger,
        linkPaymentByPurpose: deps.linkPaymentByPurpose,
        processAlegraInvoicing: deps.processAlegraInvoicing,
      },
      transaction,
    );
  }

  const result: any = {
    reference: transaction.reference,
    status: transaction.status,
    amount: transaction.amount,
    tier: transaction.tier,
    purpose: transaction.purpose,
    boldPaymentId: transaction.boldPaymentId,
    paymentMethod: transaction.paymentMethod,
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
    await deps.kvCache.set(
      statusCacheKey,
      { status: transaction.status, requiresPayment: false },
      24 * 60 * 60,
      true,
    );
  }

  return result;
}
