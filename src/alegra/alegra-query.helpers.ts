import { Model } from "mongoose";
import type { AlegraInvoiceDocument } from "./schemas/alegra-invoice.schema";

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
