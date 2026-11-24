import { Logger } from "@nestjs/common";
import { Model } from "mongoose";
import type { AlegraInvoiceDocument } from "./schemas/alegra-invoice.schema";
import type {
  AlegraBillingContext,
  CreatedInvoiceData,
  ResolvedAlegraContact,
} from "./alegra.interfaces";
import type { NotificationsService } from "../notifications/notifications.service";
import {
  NotificationType,
  NotificationPriority,
} from "../notifications/schemas/notification.schema";
import { maskReference, sanitizeForLog } from "../common/utils/log-redact.util";
import { ALEGRA_PROCESSING_STALE_MS } from "./alegra.constants";

export interface SaveApprovedInvoiceParams {
  context: AlegraBillingContext;
  invoiceData: CreatedInvoiceData;
  contactId: string;
  paymentId: string | null;
  emailed: boolean;
}

function isInvoiceStamped(invoiceData: CreatedInvoiceData): boolean {
  if (invoiceData.cufe && invoiceData.cufe.trim().length > 0) return true;
  return Boolean(invoiceData.stampStatus?.toUpperCase().startsWith("STAMPED"));
}

function resolveStampStatus(
  invoiceData: CreatedInvoiceData,
  stamped: boolean,
): string {
  if (invoiceData.stampStatus) return invoiceData.stampStatus;
  return stamped ? "STAMPED_AND_ACCEPTED" : "PENDING";
}

function resolvePersistedStatus(
  paymentId: string | null,
  stamped: boolean,
): string {
  if (paymentId) return "PAID";
  return stamped ? "STAMPED" : "CREATED";
}

function isDuplicateKeyError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  return (err as { code?: number }).code === 11000;
}

/**
 * Atomically acquires a distributed processing lock for (transactionReference, purpose)
 * before calling Alegra APIs, preventing duplicate DIAN electronic invoices under
 * concurrent Bold webhooks, voucher syncs, or user retry clicks (OWASP A08 / PR.DS-05).
 */
export async function claimInvoiceProcessingLock(
  invoiceModel: Model<AlegraInvoiceDocument>,
  context: AlegraBillingContext,
  logger: Logger,
): Promise<boolean> {
  const staleCutoff = new Date(Date.now() - ALEGRA_PROCESSING_STALE_MS);
  const claimSet = {
    userId: context.userId,
    transactionReference: context.transactionReference,
    purpose: context.purpose,
    alegraInvoiceId: "0",
    alegraContactId: "0",
    amount: context.amount,
    description: context.description,
    paymentMethod: context.paymentMethod ?? null,
    itemsSnapshot: context.items ?? null,
    status: "PROCESSING",
    errorMessage: null,
  };

  // 1. Reclaim an existing FAILED or stale PROCESSING record (never an already-issued invoice)
  const reclaimed = await invoiceModel.findOneAndUpdate(
    {
      transactionReference: context.transactionReference,
      purpose: context.purpose,
      alegraInvoiceId: "0",
      $or: [
        { status: "FAILED" },
        { status: "PROCESSING", updatedAt: { $lt: staleCutoff } },
      ],
    },
    { $set: claimSet },
    { new: true },
  );
  if (reclaimed) return true;

  // 2. Fast-path check if a non-reclaimable record already exists
  const existing = await invoiceModel.findOne({
    transactionReference: context.transactionReference,
    purpose: context.purpose,
  });
  if (existing) {
    logger.log(
      `Alegra invoice already claimed/exists (status=${existing.status}) for ref=${maskReference(context.transactionReference)} — skipping`,
    );
    return false;
  }

  // 3. Atomic unique-index insert to claim fresh invoicing ownership
  try {
    await invoiceModel.create(claimSet);
    return true;
  } catch (err: unknown) {
    if (isDuplicateKeyError(err)) {
      logger.log(
        `Concurrent Alegra invoicing claim detected for ref=${maskReference(context.transactionReference)} — skipping`,
      );
      return false;
    }
    throw err;
  }
}

export async function saveApprovedInvoice(
  invoiceModel: Model<AlegraInvoiceDocument>,
  notificationsService: NotificationsService,
  logger: Logger,
  params: SaveApprovedInvoiceParams,
): Promise<void> {
  const { context, invoiceData, contactId, paymentId, emailed } = params;
  const stamped = isInvoiceStamped(invoiceData);
  const stampStatus = resolveStampStatus(invoiceData, stamped);
  const status = resolvePersistedStatus(paymentId, stamped);
  const now = new Date();

  await invoiceModel.findOneAndUpdate(
    {
      transactionReference: context.transactionReference,
      purpose: context.purpose,
    },
    {
      $set: {
        userId: context.userId,
        transactionReference: context.transactionReference,
        purpose: context.purpose,
        alegraInvoiceId: invoiceData.invoiceId,
        alegraInvoiceNumber: invoiceData.invoiceNumber,
        alegraContactId: contactId,
        alegraPaymentId: paymentId,
        stamped,
        stampStatus,
        cufe: invoiceData.cufe,
        description: context.description,
        paymentMethod: context.paymentMethod ?? null,
        itemsSnapshot: context.items ?? null,
        emailed,
        amount: context.amount,
        status,
        paidAt: paymentId ? now : null,
        emailedAt: emailed ? now : null,
        stampedAt: stamped ? now : null,
        errorMessage: null,
      },
    },
    { upsert: true, new: true },
  );

  await notificationsService.create({
    userId: context.userId,
    type: NotificationType.INVOICE_CREATED,
    title: "Factura electrónica generada",
    message: `Tu factura electrónica ha sido generada${emailed ? " y enviada a tu correo" : ""}. Referencia: ${context.transactionReference}.`,
    priority: NotificationPriority.MEDIUM,
    metadata: {
      alegraInvoiceId: invoiceData.invoiceId,
      amount: context.amount,
      purpose: context.purpose,
    },
    relatedReference: context.transactionReference,
    notifyCategory: "Membresia y pagos",
  });

  logger.log(
    `Alegra invoicing completed: ref=${maskReference(context.transactionReference)} invoiceId=${sanitizeForLog(invoiceData.invoiceId)} stamped=${stamped} paymentId=${paymentId ? sanitizeForLog(paymentId) : "n/a"} emailed=${emailed}`,
  );
}

export async function recordFailedInvoice(
  invoiceModel: Model<AlegraInvoiceDocument>,
  notificationsService: NotificationsService,
  context: AlegraBillingContext,
  errorMessage: string,
  logger: Logger,
): Promise<void> {
  try {
    await invoiceModel.findOneAndUpdate(
      {
        transactionReference: context.transactionReference,
        purpose: context.purpose,
      },
      {
        $set: {
          userId: context.userId,
          transactionReference: context.transactionReference,
          purpose: context.purpose,
          alegraInvoiceId: "0",
          alegraContactId: "0",
          amount: context.amount,
          description: context.description,
          paymentMethod: context.paymentMethod ?? null,
          itemsSnapshot: context.items ?? null,
          status: "FAILED",
          errorMessage: sanitizeForLog(errorMessage).slice(0, 500),
        },
      },
      { upsert: true },
    );

    await notificationsService.create({
      userId: context.userId,
      type: NotificationType.INVOICE_FAILED,
      title: "Inconveniente con factura electrónica",
      message:
        "Hubo un inconveniente generando tu factura electrónica. Nuestro equipo la emitirá manualmente. No afecta tu pago.",
      priority: NotificationPriority.LOW,
      metadata: {
        transactionReference: context.transactionReference,
        purpose: context.purpose,
      },
      relatedReference: context.transactionReference,
      notifyCategory: "Membresia y pagos",
    });
  } catch {
    logger.error(
      `Failed to record failed invoice for ref=${maskReference(context.transactionReference)}`,
    );
  }
}

export interface ApprovedPaymentFlowOperations {
  ensureContactFn: (userId: string) => Promise<ResolvedAlegraContact | null>;
  createInvoiceFn: (
    context: AlegraBillingContext,
    contactId: string,
  ) => Promise<CreatedInvoiceData | null>;
  createInvoiceDetailedFn?: (
    context: AlegraBillingContext,
    contactId: string,
  ) => Promise<{ data: CreatedInvoiceData | null; errorCode: string | null }>;
  createPaymentFn: (
    invoiceId: string,
    amount: number,
    paymentMethod?: string | null,
  ) => Promise<string | null>;
  emailInvoiceFn: (
    invoiceId: string,
    recipientEmail?: string | null,
  ) => Promise<boolean>;
}

export interface RetryFailedInvoiceOutcome {
  status: "not_eligible" | "succeeded" | "failed";
  errorMessage: string | null;
}

export async function executeApprovedPaymentFlow(
  context: AlegraBillingContext,
  ops: ApprovedPaymentFlowOperations,
  invoiceModel: Model<AlegraInvoiceDocument>,
  notificationsService: NotificationsService,
  logger: Logger,
): Promise<void> {
  const {
    ensureContactFn,
    createInvoiceFn,
    createInvoiceDetailedFn,
    createPaymentFn,
    emailInvoiceFn,
  } = ops;
  try {
    const contact = await ensureContactFn(context.userId);
    if (!contact?.contactId) {
      await recordFailedInvoice(
        invoiceModel,
        notificationsService,
        context,
        "Failed to create/find contact",
        logger,
      );
      return;
    }

    let invoiceData: CreatedInvoiceData | null = null;
    let createErrorCode: string | null = null;
    if (createInvoiceDetailedFn) {
      const detailed = await createInvoiceDetailedFn(
        context,
        contact.contactId,
      );
      invoiceData = detailed.data;
      createErrorCode = detailed.errorCode;
    } else {
      invoiceData = await createInvoiceFn(context, contact.contactId);
    }

    if (!invoiceData) {
      await recordFailedInvoice(
        invoiceModel,
        notificationsService,
        context,
        createErrorCode ?? "Failed to create invoice",
        logger,
      );
      return;
    }

    let paymentId: string | null = null;
    if (context.amount > 0) {
      paymentId = await createPaymentFn(
        invoiceData.invoiceId,
        context.amount,
        context.paymentMethod,
      );
    }

    const recipientEmail = context.customerEmail ?? contact.email;
    const emailed = await emailInvoiceFn(invoiceData.invoiceId, recipientEmail);

    await saveApprovedInvoice(invoiceModel, notificationsService, logger, {
      context,
      invoiceData,
      contactId: contact.contactId,
      paymentId,
      emailed,
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error(
      `Alegra invoicing failed for ref=${maskReference(context.transactionReference)}: ${sanitizeForLog(errMsg)}`,
    );
    await recordFailedInvoice(
      invoiceModel,
      notificationsService,
      context,
      errMsg,
      logger,
    );
  }
}

export async function executeRetryFailedInvoiceDetailed(
  invoiceModel: Model<AlegraInvoiceDocument>,
  processPaymentFn: (context: AlegraBillingContext) => Promise<void>,
  transactionReference: string,
  purpose: string,
  logger: Logger,
): Promise<RetryFailedInvoiceOutcome> {
  const existing = await invoiceModel.findOne({
    transactionReference,
    purpose,
  });
  if (existing?.status !== "FAILED" || existing.alegraInvoiceId !== "0") {
    return { status: "not_eligible", errorMessage: null };
  }

  logger.log(
    `Retrying failed Alegra invoice: ref=${maskReference(transactionReference)} purpose=${purpose}`,
  );

  const context: AlegraBillingContext = {
    userId: existing.userId,
    transactionReference,
    purpose,
    amount: existing.amount,
    description: existing.description ?? `BSKMT — Ref: ${transactionReference}`,
    paymentMethod: existing.paymentMethod ?? undefined,
    items: existing.itemsSnapshot ?? undefined,
  };

  await processPaymentFn(context);

  const refreshed = await invoiceModel.findOne({
    transactionReference,
    purpose,
  });
  if (
    !refreshed ||
    refreshed.status === "FAILED" ||
    refreshed.alegraInvoiceId === "0"
  ) {
    return {
      status: "failed",
      errorMessage: refreshed?.errorMessage ?? "Failed to create invoice",
    };
  }

  return { status: "succeeded", errorMessage: null };
}

export async function executeRetryFailedInvoice(
  invoiceModel: Model<AlegraInvoiceDocument>,
  processPaymentFn: (context: AlegraBillingContext) => Promise<void>,
  transactionReference: string,
  purpose: string,
  logger: Logger,
): Promise<boolean> {
  const existing = await invoiceModel.findOne({
    transactionReference,
    purpose,
  });
  if (existing?.status !== "FAILED" || existing.alegraInvoiceId !== "0") {
    return false;
  }

  logger.log(
    `Retrying failed Alegra invoice: ref=${maskReference(transactionReference)} purpose=${purpose}`,
  );

  const context: AlegraBillingContext = {
    userId: existing.userId,
    transactionReference,
    purpose,
    amount: existing.amount,
    description: existing.description ?? `BSKMT — Ref: ${transactionReference}`,
    paymentMethod: existing.paymentMethod ?? undefined,
    items: existing.itemsSnapshot ?? undefined,
  };

  await processPaymentFn(context);
  return true;
}
