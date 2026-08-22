import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document } from "mongoose";

export type AlegraInvoiceDocument = AlegraInvoice & Document;

/**
 * Tracks the relationship between BSKMT transactions and Alegra invoices.
 *
 * Security (OWASP A09:2025 — Security Logging and Monitoring Failures):
 * The `alegraInvoiceId` and `alegraPaymentId` are third-party resource
 * identifiers — they are not PII and are safe to log. The `userId` is
 * stored for audit traceability but should be masked in logs via
 * `maskUserId`.
 *
 * Idempotency (OWASP A08:2025 — Software and Data Integrity Failures):
 * The compound unique index on (transactionReference, purpose) ensures
 * that a given BSKMT transaction is invoiced in Alegra at most once,
 * even if the Bold webhook fires multiple times or the sync job retries.
 */
@Schema({ timestamps: true })
export class AlegraInvoice {
  @Prop({ required: true, index: true })
  userId!: string;

  /** BSKMT transaction reference (e.g. MEM-…, SHOP-…, ARPHA-…). */
  @Prop({ required: true, index: true })
  transactionReference!: string;

  /** Purpose: membership | event | course | shop | arpha. */
  @Prop({ required: true })
  purpose!: string;

  /** Alegra invoice ID returned by POST /invoices. */
  @Prop({ required: true })
  alegraInvoiceId!: number;

  /** Alegra invoice number (human-readable, e.g. "SET-01"). */
  @Prop({ type: String, default: null })
  alegraInvoiceNumber!: string | null;

  /** Alegra contact ID linked to the invoice. */
  @Prop({ required: true })
  alegraContactId!: number;

  /** Alegra payment ID (if a payment was recorded). */
  @Prop({ type: Number, default: null })
  alegraPaymentId!: number | null;

  /** Whether the electronic invoice was stamped (DIAN). */
  @Prop({ default: false })
  stamped!: boolean;

  /** Stamp status from Alegra (PENDING, STAMPED_AND_ACCEPTED, etc.). */
  @Prop({ type: String, default: null })
  stampStatus!: string | null;

  /** Whether the invoice was emailed to the customer. */
  @Prop({ default: false })
  emailed!: boolean;

  /** Invoice amount in COP. */
  @Prop({ required: true })
  amount!: number;

  /** Status of the Alegra invoicing flow. */
  @Prop({
    required: true,
    default: "CREATED",
    enum: ["CREATED", "STAMPED", "PAID", "EMAILED", "FAILED", "CANCELLED"],
  })
  status!: string;

  /** Error details if the invoicing flow failed. */
  @Prop({ type: String, default: null })
  errorMessage!: string | null;

  @Prop({ type: Date, default: null })
  stampedAt!: Date | null;

  @Prop({ type: Date, default: null })
  paidAt!: Date | null;

  @Prop({ type: Date, default: null })
  emailedAt!: Date | null;

  createdAt!: Date;

  updatedAt!: Date;
}

export const AlegraInvoiceSchema = SchemaFactory.createForClass(AlegraInvoice);

AlegraInvoiceSchema.index(
  { transactionReference: 1, purpose: 1 },
  { unique: true },
);
AlegraInvoiceSchema.index({ alegraInvoiceId: 1 }, { sparse: true });
AlegraInvoiceSchema.index({ userId: 1, createdAt: -1 });
