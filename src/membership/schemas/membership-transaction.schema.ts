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
