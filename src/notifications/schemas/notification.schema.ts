import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document } from "mongoose";

export type NotificationDocument = Notification & Document;

export enum NotificationType {
  MEMBERSHIP_ACTIVATED = "membership_activated",
  MEMBERSHIP_INSTALLMENT_PAID = "membership_installment_paid",
  MEMBERSHIP_INSTALLMENT_COMPLETE = "membership_installment_complete",
  MEMBERSHIP_PAYMENT_REJECTED = "membership_payment_rejected",
  MEMBERSHIP_EXPIRED = "membership_expired",
  MEMBERSHIP_GRACE_PERIOD = "membership_grace_period",
  MEMBERSHIP_REVOKED = "membership_revoked",
  PAYMENT_APPROVED = "payment_approved",
  PAYMENT_REJECTED = "payment_rejected",
}

export enum NotificationPriority {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
}

@Schema({ timestamps: true, collection: "notifications" })
export class Notification {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({
    required: true,
    enum: Object.values(NotificationType),
  })
  type: string;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  message: string;

  @Prop({
    required: true,
    enum: Object.values(NotificationPriority),
    default: NotificationPriority.MEDIUM,
  })
  priority: string;

  @Prop({ default: false })
  read: boolean;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, unknown>;

  @Prop()
  relatedReference: string;

  createdAt: Date;
  updatedAt: Date;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);
