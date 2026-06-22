import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document } from "mongoose";

export type WishlistItemDocument = WishlistItem & Document;

@Schema({ timestamps: true })
export class WishlistItem {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true })
  productSlug: string;
}

export const WishlistItemSchema = SchemaFactory.createForClass(WishlistItem);

WishlistItemSchema.index({ userId: 1, productSlug: 1 }, { unique: true });
