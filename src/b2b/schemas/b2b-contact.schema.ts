import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document } from "mongoose";

export type B2bContactDocument = B2bContact & Document;

@Schema({ timestamps: true })
export class B2bContact {
  @Prop({ required: true, trim: true, maxlength: 100 })
  companyName: string;

  @Prop({ required: true, trim: true, maxlength: 100 })
  contactName: string;

  @Prop({ required: true, trim: true, lowercase: true })
  email: string;

  @Prop({
    required: true,
    enum: [
      "Patrocinio",
      "Marca compartida",
      "Intercambio de datos",
      "Activación de marca",
      "Otro",
    ],
  })
  interest: string;

  @Prop({ required: true, trim: true, maxlength: 2000 })
  message: string;

  @Prop({ default: false })
  reviewed: boolean;
}

export const B2bContactSchema = SchemaFactory.createForClass(B2bContact);

B2bContactSchema.index({ email: 1 });
B2bContactSchema.index({ createdAt: -1 });
