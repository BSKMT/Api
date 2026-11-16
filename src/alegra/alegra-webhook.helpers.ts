import { Logger } from "@nestjs/common";
import { Model } from "mongoose";
import type { AlegraInvoiceDocument } from "./schemas/alegra-invoice.schema";
import type { AlegraWebhookPayload } from "./alegra.interfaces";
import { maskReference } from "../common/utils/log-redact.util";

export async function processInvoiceWebhookEvent(
  invoiceModel: Model<AlegraInvoiceDocument>,
  payload: AlegraWebhookPayload,
  subject: string,
  logger: Logger,
): Promise<void> {
  const invoice = payload?.message?.invoice;
  if (!invoice?.id) {
    logger.warn("Alegra invoice webhook without valid invoice data");
    return;
  }

  const record = await invoiceModel.findOne({
    alegraInvoiceId: invoice.id,
  });

  if (!record) {
    logger.debug(`Alegra webhook for unknown invoiceId=${invoice.id}`);
    return;
  }

  if (subject.includes("delete")) {
    record.status = "CANCELLED";
    await record.save();
    logger.log(
      `Alegra invoice cancelled: invoiceId=${invoice.id} ref=${maskReference(record.transactionReference)}`,
    );
    return;
  }

  let modified = false;

  // Reconcile stamp / DIAN data if present in webhook
  if (invoice.stamp?.cufe && !record.cufe) {
    record.cufe = invoice.stamp.cufe;
    record.stamped = true;
    record.stampedAt = new Date();
    modified = true;
  }

  if (
    invoice.stamp?.legalStatus &&
    record.stampStatus !== invoice.stamp.legalStatus
  ) {
    record.stampStatus = invoice.stamp.legalStatus;
    if (invoice.stamp.legalStatus.startsWith("STAMPED")) {
      record.stamped = true;
      if (!record.stampedAt) record.stampedAt = new Date();
    }
    modified = true;
  }

  if (invoice.numberTemplate?.fullNumber && !record.alegraInvoiceNumber) {
    record.alegraInvoiceNumber = invoice.numberTemplate.fullNumber;
    modified = true;
  }

  if (subject.includes("edit") || subject.includes("new")) {
    if (invoice.balance === 0 && record.status !== "PAID") {
      record.status = "PAID";
      record.paidAt = new Date();
      modified = true;
      logger.log(
        `Alegra invoice marked paid: invoiceId=${invoice.id} ref=${maskReference(record.transactionReference)}`,
      );
    }
  }

  if (modified) {
    await record.save();
  }
}
