import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document } from "mongoose";

export type ArphaRequestDocument = ArphaRequest & Document;

export enum ArphaRequestType {
  TECNICA = "tecnica",
  EMERGENCIA = "emergencia",
  JURIDICA = "juridica",
  RUTA = "ruta",
}

export enum ArphaRequestStatus {
  PENDING = "PENDING",
  EN_CAMINO = "EN_CAMINO",
  COMPLETED = "COMPLETED",
  CANCELLED = "CANCELLED",
}

@Schema({ timestamps: true })
export class ArphaRequest {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({
    required: true,
    enum: Object.values(ArphaRequestType),
  })
  requestType: ArphaRequestType;

  @Prop({
    required: true,
    default: ArphaRequestStatus.PENDING,
    enum: Object.values(ArphaRequestStatus),
  })
  status: ArphaRequestStatus;

  @Prop({ required: true })
  location: string;

  @Prop({ type: String, default: null })
  description: string | null;

  @Prop({ type: String, default: null })
  assignedTechnician: string | null;

  @Prop({ type: String, default: null })
  eta: string | null;

  @Prop({ type: String, default: null })
  resolution: string | null;

  @Prop({ type: Number, default: null })
  rating: number | null;

  @Prop({ type: String, default: null })
  comment: string | null;

  @Prop({ type: Date, default: null })
  resolvedAt: Date | null;

  @Prop({ type: Date, default: null })
  cancelledAt: Date | null;
}

export const ArphaRequestSchema = SchemaFactory.createForClass(ArphaRequest);

ArphaRequestSchema.index({ userId: 1, createdAt: -1 });
