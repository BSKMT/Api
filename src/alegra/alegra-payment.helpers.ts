import { Logger } from "@nestjs/common";
import { Model } from "mongoose";
import type { AlegraInvoiceDocument } from "./schemas/alegra-invoice.schema";
import type {
  AlegraBillingContext,
  CreatedInvoiceData,
} from "./alegra.interfaces";
import type { NotificationsService } from "../notifications/notifications.service";
import {
  NotificationType,
  NotificationPriority,
} from "../notifications/schemas/notification.schema";
import { maskReference } from "../common/utils/log-redact.util";

export async function saveApprovedInvoice(
  invoiceModel: Model<AlegraInvoiceDocument>,
  notificationsService: NotificationsService,
  context: AlegraBillingContext,
  invoiceData: CreatedInvoiceData,
  contactId: string,
  paymentId: string | null,
  emailed: boolean,
  logger: Logger,
): Promise<void> {
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
        stamped: true,
        stampStatus: invoiceData.stampStatus ?? "STAMPED_AND_ACCEPTED",
        cufe: invoiceData.cufe,
        description: context.description,
        emailed,
        amount: context.amount,
        status: paymentId ? "PAID" : "STAMPED",
        paidAt: paymentId ? new Date() : null,
        emailedAt: emailed ? new Date() : null,
        stampedAt: new Date(),
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
    `Alegra invoicing completed: ref=${maskReference(context.transactionReference)} invoiceId=${invoiceData.invoiceId} paymentId=${paymentId ?? "n/a"} emailed=${emailed}`,
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
          status: "FAILED",
          errorMessage: errorMessage.slice(0, 500),
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

export async function executeApprovedPaymentFlow(
  context: AlegraBillingContext,
  ensureContactFn: (userId: string) => Promise<string | null>,
  createInvoiceFn: (
    context: AlegraBillingContext,
    contactId: string,
  ) => Promise<CreatedInvoiceData | null>,
  createPaymentFn: (
    invoiceId: string,
    amount: number,
  ) => Promise<string | null>,
  emailInvoiceFn: (invoiceId: string) => Promise<boolean>,
  invoiceModel: Model<AlegraInvoiceDocument>,
  notificationsService: NotificationsService,
  logger: Logger,
): Promise<void> {
  try {
    const contactId = await ensureContactFn(context.userId);
    if (!contactId) {
      await recordFailedInvoice(
        invoiceModel,
        notificationsService,
        context,
        "Failed to create/find contact",
        logger,
      );
      return;
    }

    const invoiceData = await createInvoiceFn(context, contactId);
    if (!invoiceData) {
      await recordFailedInvoice(
        invoiceModel,
        notificationsService,
        context,
        "Failed to create invoice",
        logger,
      );
      return;
    }

    let paymentId: string | null = null;
    if (context.amount > 0) {
      paymentId = await createPaymentFn(invoiceData.invoiceId, context.amount);
    }

    const emailed = await emailInvoiceFn(invoiceData.invoiceId);
    await saveApprovedInvoice(
      invoiceModel,
      notificationsService,
      context,
      invoiceData,
      contactId,
      paymentId,
      emailed,
      logger,
    );
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error(
      `Alegra invoicing failed for ref=${maskReference(context.transactionReference)}: ${errMsg}`,
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

export async function queryInvoicesForUser(
  invoiceModel: Model<AlegraInvoiceDocument>,
  userId: string,
): Promise<Map<string, AlegraInvoiceDocument>> {
  const invoices = await invoiceModel.find({ userId }).lean();
  const map = new Map<string, AlegraInvoiceDocument>();
  for (const inv of invoices) {
    map.set(
      `${inv.transactionReference}:${inv.purpose}`,
      inv as AlegraInvoiceDocument,
    );
  }
  return map;
}

export async function queryInvoicePdfUrlByTransaction(
  invoiceModel: Model<AlegraInvoiceDocument>,
  getPdfUrlFn: (invoiceId: string) => Promise<string | null>,
  userId: string,
  transactionReference: string,
  purpose: string,
): Promise<string | null> {
  const record = await invoiceModel.findOne({
    userId,
    transactionReference,
    purpose,
  });
  if (!record?.alegraInvoiceId || record.alegraInvoiceId === "0") {
    return null;
  }
  return getPdfUrlFn(record.alegraInvoiceId);
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
  if (!existing || existing.status !== "FAILED") {
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
  };

  await processPaymentFn(context);
  return true;
}
