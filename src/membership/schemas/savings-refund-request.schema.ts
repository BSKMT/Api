import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document, Schema as MongooseSchema } from "mongoose";

export type SavingsRefundRequestDocument = SavingsRefundRequest & Document;

export enum SavingsRefundStatus {
  PENDING_CONSOLE_REVIEW = "pending_console_review",
  PENDING_FINANCE_APPROVAL = "pending_finance_approval",
  APPROVED = "approved",
  REJECTED = "rejected",
  APPEALED = "appealed",
  LEGAL_ESCALATED = "legal_escalated",
  LEGAL_RESOLVED_APPROVED = "legal_resolved_approved",
  LEGAL_RESOLVED_REJECTED = "legal_resolved_rejected",
}

@Schema({ _id: false })
export class SavingsBankDetails {
  @Prop({ required: true })
  bankName!: string;

  @Prop({
    required: true,
    enum: ["ahorros", "corriente", "Ahorros", "Corriente"],
  })
  accountType!: string;

  @Prop({ required: true })
  accountNumber!: string;

  @Prop({ required: true })
  accountHolderName!: string;

  @Prop({ required: true, default: "CC" })
  identificationType!: string;

  @Prop({ required: true })
  identificationNumber!: string;
}

export const SavingsBankDetailsSchema =
  SchemaFactory.createForClass(SavingsBankDetails);

@Schema({ _id: false })
export class RefundReviewStep {
  @Prop({ default: "" })
  reviewedBy?: string;

  @Prop({ type: Date, default: null })
  reviewedAt?: Date | null;

  @Prop({
    type: String,
    enum: ["none", "approved", "rejected"],
    default: "none",
  })
  status!: "none" | "approved" | "rejected";

  @Prop({ default: "" })
  notes?: string;

  @Prop({ default: "" })
  radicadoDocument?: string;
}

export const RefundReviewStepSchema =
  SchemaFactory.createForClass(RefundReviewStep);

@Schema({ _id: false })
export class RefundAppealItem {
  @Prop({ required: true })
  appealNumber!: number;

  @Prop({ type: Date, default: () => new Date() })
  appealedAt!: Date;

  @Prop({ required: true })
  userExplanation!: string;

  @Prop({ type: RefundReviewStepSchema, default: () => ({}) })
  consoleReview?: RefundReviewStep;

  @Prop({ type: RefundReviewStepSchema, default: () => ({}) })
  financeReview?: RefundReviewStep;

  @Prop({
    type: String,
    enum: ["pending", "approved", "rejected"],
    default: "pending",
  })
  status!: "pending" | "approved" | "rejected";
}

export const RefundAppealItemSchema =
  SchemaFactory.createForClass(RefundAppealItem);

@Schema({ _id: false })
export class LegalEscalationDetails {
  @Prop({ type: Date, default: null })
  escalatedAt?: Date | null;

  @Prop({ default: "" })
  userStatement?: string;

  @Prop({
    type: String,
    enum: ["none", "approved", "rejected"],
    default: "none",
  })
  decision!: "none" | "approved" | "rejected";

  @Prop({ type: Date, default: null })
  decisionDate?: Date | null;

  @Prop({ default: "" })
  committeeNotes?: string;

  @Prop({ default: "" })
  committeeRadicado?: string;
}

export const LegalEscalationDetailsSchema = SchemaFactory.createForClass(
  LegalEscalationDetails,
);

@Schema({ _id: false })
export class RefundTimelineItem {
  @Prop({ type: Date, default: () => new Date() })
  timestamp!: Date;

  @Prop({ required: true })
  actor!: string;

  @Prop({ required: true })
  action!: string;

  @Prop({ default: "" })
  details?: string;

  @Prop({ default: "" })
  radicado?: string;
}

export const RefundTimelineItemSchema =
  SchemaFactory.createForClass(RefundTimelineItem);

@Schema({ timestamps: true })
export class SavingsRefundRequest {
  @Prop({ required: true, unique: true, index: true })
  radicadoNumber!: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  })
  userId!: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: "SavingsPlan" })
  savingsPlanId?: string;

  @Prop({ required: true })
  totalSavedAmount!: number;

  @Prop({ default: 20 })
  retentionPercentage!: number;

  @Prop({ required: true })
  retentionAmount!: number;

  @Prop({ required: true })
  netRefundAmount!: number;

  @Prop({ type: SavingsBankDetailsSchema, required: true })
  bankDetails!: SavingsBankDetails;

  @Prop({
    type: String,
    enum: Object.values(SavingsRefundStatus),
    default: SavingsRefundStatus.PENDING_CONSOLE_REVIEW,
    index: true,
  })
  status!: SavingsRefundStatus;

  @Prop({ type: RefundReviewStepSchema, default: () => ({}) })
  consoleReview!: RefundReviewStep;

  @Prop({ type: RefundReviewStepSchema, default: () => ({}) })
  financeReview!: RefundReviewStep;

  @Prop({ default: 0 })
  appealCount!: number;

  @Prop({ default: 3 })
  maxAppeals!: number;

  @Prop({ type: [RefundAppealItemSchema], default: [] })
  appeals!: RefundAppealItem[];

  @Prop({ type: LegalEscalationDetailsSchema, default: () => ({}) })
  legalEscalation!: LegalEscalationDetails;

  @Prop({ type: [RefundTimelineItemSchema], default: [] })
  timeline!: RefundTimelineItem[];
}

export const SavingsRefundRequestSchema =
  SchemaFactory.createForClass(SavingsRefundRequest);
