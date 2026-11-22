import { Logger } from "@nestjs/common";
import { Model } from "mongoose";
import type { AlegraInvoiceDocument } from "./schemas/alegra-invoice.schema";
import type { AlegraWebhookPayload } from "./alegra.interfaces";
import { maskReference, sanitizeForLog } from "../common/utils/log-redact.util";
import { isValidAlegraId } from "./alegra.constants";

type WebhookInvoice = NonNullable<AlegraWebhookPayload["message"]>["invoice"];
const REJECTED_STAMP_STATUSES = new Set(["REJECTED", "ERROR", "FAILED"]);

function extractWebhookInvoiceNumber(
  numberTemplate?: NonNullable<WebhookInvoice>["numberTemplate"],
): string | null {
  if (!numberTemplate) return null;
  if (numberTemplate.fullNumber) return numberTemplate.fullNumber;
  if (numberTemplate.prefix) {
    return `${numberTemplate.prefix}${numberTemplate.number ?? ""}`;
  }
  return null;
}

function reconcileInvoiceStamp(
  record: AlegraInvoiceDocument,
  invoice: WebhookInvoice,
): boolean {
  if (!invoice) return false;
  let modified = false;

  if (invoice.stamp?.cufe && !record.cufe) {
    record.cufe = invoice.stamp.cufe;
    record.stamped = true;
    record.stampedAt = record.stampedAt ?? new Date();
    modified = true;
  }

  if (
    invoice.stamp?.legalStatus &&
    record.stampStatus !== invoice.stamp.legalStatus
  ) {
    record.stampStatus = invoice.stamp.legalStatus;
    const upper = invoice.stamp.legalStatus.toUpperCase();
    if (upper.startsWith("STAMPED")) {
      record.stamped = true;
      record.stampedAt ??= new Date();
    } else if (REJECTED_STAMP_STATUSES.has(upper)) {
      record.stamped = false;
    }
    modified = true;
  }

  const invoiceNumber = extractWebhookInvoiceNumber(invoice.numberTemplate);
  if (invoiceNumber && !record.alegraInvoiceNumber) {
    record.alegraInvoiceNumber = invoiceNumber;
    modified = true;
  }

  return modified;
}

function isCancellationWebhook(
  subject: string,
  invoice: NonNullable<WebhookInvoice>,
): boolean {
  const lowerSubject = subject.toLowerCase();
  const lowerStatus = (invoice.status ?? "").toLowerCase();
  return (
    lowerSubject.includes("delete") ||
    lowerSubject.includes("void") ||
    lowerSubject.includes("cancel") ||
    lowerStatus === "void"
  );
}

export async function processInvoiceWebhookEvent(
  invoiceModel: Model<AlegraInvoiceDocument>,
  payload: AlegraWebhookPayload,
  subject: string,
  logger: Logger,
): Promise<void> {
  const invoice = payload?.message?.invoice;
  const rawId =
    invoice &&
    (typeof invoice.id === "string" || typeof invoice.id === "number")
      ? String(invoice.id).trim()
      : "";

  if (!invoice || !isValidAlegraId(rawId)) {
    logger.warn("Alegra invoice webhook without valid invoice data");
    return;
  }

  const logId = sanitizeForLog(rawId);
  const record = await invoiceModel.findOne({ alegraInvoiceId: rawId });
  if (!record) {
    logger.debug(`Alegra webhook for unknown invoiceId=${logId}`);
    return;
  }

  if (isCancellationWebhook(subject, invoice)) {
    record.status = "CANCELLED";
    await record.save();
    logger.log(
      `Alegra invoice cancelled: invoiceId=${logId} ref=${maskReference(record.transactionReference)}`,
    );
    return;
  }

  let modified = reconcileInvoiceStamp(record, invoice);
  const lowerStatus = (invoice.status ?? "").toLowerCase();
  const lowerSubject = subject.toLowerCase();

  if (
    (lowerSubject.includes("edit") || lowerSubject.includes("new")) &&
    lowerStatus !== "draft" &&
    invoice.balance === 0 &&
    record.status !== "PAID"
  ) {
    record.status = "PAID";
    record.paidAt = new Date();
    modified = true;
    logger.log(
      `Alegra invoice marked paid: invoiceId=${logId} ref=${maskReference(record.transactionReference)}`,
    );
  }

  if (modified) {
    await record.save();
  }
}
