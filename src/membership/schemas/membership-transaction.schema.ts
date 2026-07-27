import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document } from "mongoose";

export type MembershipTransactionDocument = MembershipTransaction & Document;

@Schema({ timestamps: true })
export class MembershipTransaction {
  @Prop({ required: true, index: true })
  userId!: string;

  @Prop({ required: true, unique: true, index: true })
  reference!: string;

  @Prop({ required: true, enum: ["single", "installment"] })
  paymentPlan!: string;

  @Prop({ required: true })
  amount!: number;

  @Prop({ required: true, default: 1 })
  installmentNumber!: number;

  @Prop({ required: true, default: 1 })
  installmentTotal!: number;

  @Prop({ required: true, default: "PENDING" })
  status!: string;

  @Prop()
  boldPaymentId!: string;

  @Prop()
  paymentMethod!: string;

  @Prop()
  payerEmail!: string;

  @Prop({ default: false })
  isRenewal!: boolean;

  // M9: Track credit used so it can be reverted if payment fails
  @Prop({ type: Number, default: 0 })
  creditUsedAmount!: number;

  // C-2/C-3: Idempotency flags — prevent double-granting of benefits and
  // double-reverting of credit across duplicate webhook/sync events.
  @Prop({ default: false })
  benefitGranted!: boolean;

  @Prop({ default: false })
  creditReverted!: boolean;

  @Prop({ type: Date, default: null })
  paidAt!: Date | null;

  @Prop({ type: Object, default: [] })
  webhookEvents!: Record<string, unknown>[];

  @Prop({ type: Date, default: null })
  lastBoldSyncAt!: Date | null;

  createdAt!: Date;

  updatedAt!: Date;
}

export const MembershipTransactionSchema = SchemaFactory.createForClass(
  MembershipTransaction,
);

MembershipTransactionSchema.index({ userId: 1, installmentNumber: 1 });
MembershipTransactionSchema.index({ boldPaymentId: 1 }, { sparse: true });

// A-6: Partial unique index — at most one APPROVED transaction per
// (user, plan, term, installment). Multiple PENDING attempts are still
// tolerated in case a webhook arrives while the user is retrying; the
// sweeper eventually collapses abandoned PENDING to VOIDED. The
// in-service guard (`createMembershipPayment`) additionally rejects new
// intents when a PENDING already exists for the same installment key to
// avoid two Bold checkout links charging the same cuota.
MembershipTransactionSchema.index(
  {
    userId: 1,
    paymentPlan: 1,
    isRenewal: 1,
    installmentNumber: 1,
  },
  {
    unique: true,
    partialFilterExpression: { status: "APPROVED" },
  },
);
