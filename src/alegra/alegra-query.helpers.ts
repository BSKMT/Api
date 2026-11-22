import { Model } from "mongoose";
import type { AlegraInvoiceDocument } from "./schemas/alegra-invoice.schema";
import type { AlegraInvoicePdfDetails } from "./alegra.interfaces";
import { ALEGRA_ALLOWED_PURPOSES, isValidAlegraId } from "./alegra.constants";

const NON_DOWNLOADABLE_STATUSES = new Set([
  "FAILED",
  "PROCESSING",
  "CANCELLED",
]);
const REJECTED_STAMP_STATUSES = new Set(["REJECTED", "ERROR", "FAILED"]);

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

function buildReconciliationPatch(
  record: AlegraInvoiceDocument,
  details: AlegraInvoicePdfDetails,
): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  if (details.invoiceNumber && !record.alegraInvoiceNumber) {
    patch.alegraInvoiceNumber = details.invoiceNumber;
  }
  if (details.cufe && !record.cufe) {
    patch.cufe = details.cufe;
    patch.stamped = true;
    patch.stampedAt = record.stampedAt ?? new Date();
  }
  if (details.stampStatus && record.stampStatus !== details.stampStatus) {
    patch.stampStatus = details.stampStatus;
    const upper = details.stampStatus.toUpperCase();
    if (upper.startsWith("STAMPED")) {
      patch.stamped = true;
      patch.stampedAt = record.stampedAt ?? new Date();
    } else if (REJECTED_STAMP_STATUSES.has(upper)) {
      patch.stamped = false;
    }
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

export async function queryInvoicePdfUrlByTransaction(
  invoiceModel: Model<AlegraInvoiceDocument>,
  getPdfDetailsFn: (
    invoiceId: string,
  ) => Promise<AlegraInvoicePdfDetails | null>,
  userId: string,
  transactionReference: string,
  purpose?: string,
): Promise<string | null> {
  const query: Record<string, unknown> = {
    userId,
    transactionReference,
  };
  if (purpose) {
    if (!ALEGRA_ALLOWED_PURPOSES.has(purpose)) {
      return null;
    }
    query.purpose = purpose;
  }

  const record = await invoiceModel.findOne(query);
  if (
    !record ||
    !isValidAlegraId(record.alegraInvoiceId) ||
    NON_DOWNLOADABLE_STATUSES.has(record.status)
  ) {
    return null;
  }

  const details = await getPdfDetailsFn(record.alegraInvoiceId);
  if (!details?.pdfUrl) {
    return null;
  }

  // Self-healing read-through reconciliation for asynchronous DIAN stamping
  const patch = buildReconciliationPatch(record, details);
  if (patch) {
    await invoiceModel
      .updateOne({ _id: record._id }, { $set: patch })
      .catch(() => {});
  }

  return details.pdfUrl;
}
