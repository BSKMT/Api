import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document, Schema as MongooseSchema } from "mongoose";

export type SavingsPlanDocument = SavingsPlan & Document;

export enum SavingsPlanStatus {
  ACTIVE = "active",
  GRACE_PERIOD_1 = "grace_period_1",
  EXTENSION_REQUESTED = "extension_requested",
  GRACE_PERIOD_2 = "grace_period_2",
  LAPSED_TEMPORARY = "lapsed_temporary",
  COMPLETED = "completed",
  REFUND_REQUESTED = "refund_requested",
  REFUNDED = "refunded",
}

@Schema({ _id: false })
export class SavingsExtensionRequest {
  @Prop({ type: Date, default: null })
  requestedAt!: Date | null;

  @Prop({ default: "" })
  reason!: string;

  @Prop({
    type: String,
    enum: ["none", "pending", "approved", "rejected"],
    default: "none",
  })
  status!: "none" | "pending" | "approved" | "rejected";

  @Prop({ type: Date, default: null })
  reviewedAt?: Date | null;

  @Prop({ default: "" })
  reviewedBy?: string;

  @Prop({ default: "" })
  directorNotes?: string;
}

export const SavingsExtensionRequestSchema = SchemaFactory.createForClass(
  SavingsExtensionRequest,
);

@Schema({ timestamps: true })
export class SavingsPlan {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  })
  userId!: string;

  @Prop({ required: true, default: 2027 })
  seasonYear!: number;

  @Prop({ default: false })
  isRenewal!: boolean;

  @Prop({ default: 12 })
  targetInstallments!: number;

  @Prop({ default: 0 })
  installmentsPaid!: number;

  @Prop({ default: 0 })
  totalAmountSaved!: number;

  @Prop({ default: 280000 })
  installmentAmount!: number;

  @Prop({
    type: String,
    enum: Object.values(SavingsPlanStatus),
    default: SavingsPlanStatus.ACTIVE,
    index: true,
  })
  status!: SavingsPlanStatus;

  @Prop({ type: Date, default: null })
  gracePeriod1ExpiresAt?: Date | null;

  @Prop({ type: Date, default: null })
  gracePeriod2ExpiresAt?: Date | null;

  @Prop({ type: SavingsExtensionRequestSchema, default: () => ({}) })
  extensionRequest!: SavingsExtensionRequest;

  @Prop({ default: 0 })
  excessInstallments!: number;

  @Prop({ type: Date, default: null })
  completedAt?: Date | null;

  @Prop({ type: Date, default: null })
  reinstatedAt?: Date | null;
}

export const SavingsPlanSchema = SchemaFactory.createForClass(SavingsPlan);

SavingsPlanSchema.index({ userId: 1, seasonYear: 1 }, { unique: true });
