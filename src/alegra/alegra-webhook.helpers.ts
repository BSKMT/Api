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

  if (subject.includes("edit") || subject.includes("new")) {
    if (invoice.balance === 0 && record.status !== "PAID") {
      record.status = "PAID";
      record.paidAt = new Date();
      await record.save();
      logger.log(
        `Alegra invoice marked paid: invoiceId=${invoice.id} ref=${maskReference(record.transactionReference)}`,
      );
    }
  }
}
