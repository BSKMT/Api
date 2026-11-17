import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document } from "mongoose";

export type AlliedWorkshopDocument = AlliedWorkshop & Document;

@Schema({ timestamps: true, collection: "allied_workshops" })
export class AlliedWorkshop {
  @Prop({ required: true, unique: true, index: true, trim: true })
  workshopId!: string;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true, trim: true })
  address!: string;

  @Prop({ required: true, trim: true })
  city!: string;

  @Prop({ required: true, trim: true })
  phone!: string;

  @Prop({ type: [String], default: [] })
  services!: string[];

  @Prop({ required: true, default: 15 })
  discountPercent!: number;

  @Prop({ default: true })
  isAlliedCertified!: boolean;

  @Prop({ default: true, index: true })
  isActive!: boolean;
}

export const AlliedWorkshopSchema =
  SchemaFactory.createForClass(AlliedWorkshop);

AlliedWorkshopSchema.index({ isActive: 1, city: 1 });
