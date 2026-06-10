import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document } from "mongoose";

export type ServiceCreditTransactionDocument = ServiceCreditTransaction &
  Document;

export enum CreditTransactionType {
  CREDIT_GRANTED = "credit-granted",
  CREDIT_USED = "credit-used",
  CREDIT_REFUNDED = "credit-refunded",
  CREDIT_EXPIRED = "credit-expired",
  CREDIT_CONVERTED_TO_MEMBERSHIP = "credit-converted-to-membership",
  CREDIT_CONVERTED_FROM_RENEWAL = "credit-converted-from-renewal",
}

export enum CreditSource {
  MEMBERSHIP = "membership",
  SERVICES = "services",
}

@Schema({ timestamps: true })
export class ServiceCreditTransaction {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true, unique: true, index: true })
  reference: string;

  @Prop({
    required: true,
    enum: Object.values(CreditTransactionType),
  })
  transactionType: string;

  @Prop({
    required: true,
    enum: Object.values(CreditSource),
  })
  creditSource: string;

  @Prop({ required: true })
  amount: number;

  @Prop()
  description: string;

  @Prop()
  relatedService: string;

  @Prop()
  relatedTransactionId: string;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, unknown>;

  createdAt: Date;

  updatedAt: Date;
}

export const ServiceCreditTransactionSchema = SchemaFactory.createForClass(
  ServiceCreditTransaction,
);

ServiceCreditTransactionSchema.index({ userId: 1, createdAt: -1 });
ServiceCreditTransactionSchema.index({ creditSource: 1 });
