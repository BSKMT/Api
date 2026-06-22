import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document } from "mongoose";

export type ProductDocument = Product & Document;

export enum ProductStatus {
  DRAFT = "draft",
  PUBLISHED = "published",
  DISCONTINUED = "discontinued",
}

@Schema({ timestamps: true })
export class Product {
  @Prop({ required: true, unique: true, index: true })
  slug: string;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  collection: string;

  @Prop({ type: String, default: null })
  description: string | null;

  @Prop({ type: String, default: null })
  image: string | null;

  @Prop({ required: true })
  publicPrice: number;

  @Prop({ required: true, default: 20 })
  memberDiscountPercent: number;

  @Prop({ required: true, default: 0 })
  stock: number;

  @Prop({ default: false })
  isNew: boolean;

  @Prop({ default: true })
  featured: boolean;

  @Prop({
    required: true,
    enum: Object.values(ProductStatus),
    default: ProductStatus.PUBLISHED,
  })
  status: string;
}

export const ProductSchema = SchemaFactory.createForClass(Product);

ProductSchema.index({ status: 1, featured: -1 });
