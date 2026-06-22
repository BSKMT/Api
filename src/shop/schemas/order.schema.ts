import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document } from "mongoose";

export type OrderDocument = Order & Document;

export enum OrderStatus {
  PENDING = "PENDING",
  PAID = "PAID",
  SHIPPED = "SHIPPED",
  DELIVERED = "DELIVERED",
  CANCELLED = "CANCELLED",
}

@Schema({ timestamps: true })
export class OrderItem {
  @Prop({ required: true })
  productSlug: string;

  @Prop({ required: true })
  productName: string;

  @Prop({ required: true })
  unitPrice: number;

  @Prop({ required: true })
  quantity: number;

  @Prop({ required: true })
  subtotal: number;
}

@Schema({ timestamps: true })
export class Order {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true, unique: true })
  orderNumber: string;

  @Prop({ type: [Object], default: [] })
  items: OrderItem[];

  @Prop({ required: true })
  total: number;

  @Prop({ required: true, default: 0 })
  memberDiscount: number;

  @Prop({
    required: true,
    default: OrderStatus.PENDING,
    enum: Object.values(OrderStatus),
  })
  status: OrderStatus;

  @Prop({ type: String, default: null })
  transactionReference: string | null;

  @Prop({ type: String, default: null })
  trackingNumber: string | null;

  @Prop({ type: String, default: null })
  shippingAddress: string | null;
}

export const OrderSchema = SchemaFactory.createForClass(Order);
OrderSchema.index({ userId: 1, createdAt: -1 });
