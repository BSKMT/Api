import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document } from "mongoose";

export type TransactionDocument = Transaction & Document;

@Schema({ _id: false })
export class CompanionData {
  @Prop({ required: true, trim: true })
  fullName: string;

  @Prop({ required: true, trim: true })
  documentId: string;

  @Prop({ required: true, trim: true })
  phone: string;

  @Prop({ required: true, trim: true, lowercase: true })
  email: string;
}

export const CompanionDataSchema = SchemaFactory.createForClass(CompanionData);

@Schema({ _id: false })
export class WebhookEvent {
  @Prop({ required: true })
  type: string;

  @Prop({ required: true, type: Date })
  receivedAt: Date;

  @Prop({ required: true, default: "UNKNOWN" })
  notificationId: string;

  @Prop({ required: true, default: "UNKNOWN" })
  paymentId: string;

  @Prop({ type: Object })
  data: Record<string, unknown>;
}

export const WebhookEventSchema = SchemaFactory.createForClass(WebhookEvent);

@Schema({ timestamps: true })
export class Transaction {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true })
  eventSlug: string;

  @Prop({ required: true, unique: true, index: true })
  reference: string;

  @Prop()
  boldPaymentId: string;

  @Prop({ required: true })
  amount: number;

  @Prop({ required: true })
  description: string;

  @Prop({ required: true, default: "PENDING" })
  status: string;

  @Prop()
  paymentMethod: string;

  @Prop()
  payerEmail: string;

  @Prop({ required: true })
  tier: string;

  @Prop({ default: false })
  hasCompanion: boolean;

  @Prop({ type: CompanionDataSchema })
  companionData: CompanionData;

  @Prop({ type: [WebhookEventSchema], default: [] })
  webhookEvents: WebhookEvent[];

  @Prop({ type: String, default: "event" })
  purpose: string;

  @Prop({ type: String, default: null })
  relatedReference: string | null;

  createdAt: Date;

  updatedAt: Date;
}

export const TransactionSchema = SchemaFactory.createForClass(Transaction);

TransactionSchema.index({ userId: 1, createdAt: -1 });
TransactionSchema.index({ boldPaymentId: 1 }, { sparse: true });
