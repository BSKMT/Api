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

export const ARPHA_PRICING: Record<string, number> = {
  tecnica: 55000,
  ruta: 85000,
  emergencia: 145000,
  juridica: 195000,
};

@Schema({ timestamps: true })
export class ArphaRequest {
  @Prop({ required: true, index: true })
  userId!: string;

  @Prop({
    required: true,
    enum: Object.values(ArphaRequestType),
  })
  requestType!: ArphaRequestType;

  @Prop({
    required: true,
    default: ArphaRequestStatus.PENDING,
    enum: Object.values(ArphaRequestStatus),
  })
  status!: ArphaRequestStatus;

  @Prop({ required: true })
  location!: string;

  @Prop({
    type: {
      lat: { type: Number, required: true },
      lng: { type: Number, required: true },
    },
    default: null,
    _id: false,
  })
  coordinates?: { lat: number; lng: number } | null;

  @Prop({ type: String, default: null })
  description!: string | null;

  @Prop({ type: String, default: null })
  assignedTechnician!: string | null;

  @Prop({
    type: String,
    enum: ["campo", "mesa"],
    default: null,
  })
  assignedType?: "campo" | "mesa" | null;

  @Prop({ type: String, default: null })
  assignedGestorId?: string | null;

  @Prop({ type: String, default: null })
  assignedGestorName?: string | null;

  @Prop({
    type: {
      lat: { type: Number, required: true },
      lng: { type: Number, required: true },
      updatedAt: { type: Date, default: Date.now },
    },
    default: null,
    _id: false,
  })
  gestorLocation?: { lat: number; lng: number; updatedAt?: Date } | null;

  @Prop({ type: String, default: null })
  eta!: string | null;

  @Prop({ type: String, default: null })
  resolution!: string | null;

  @Prop({ type: Number, default: null })
  rating!: number | null;

  @Prop({ type: String, default: null })
  comment!: string | null;

  @Prop({ type: Date, default: null })
  resolvedAt!: Date | null;

  @Prop({ type: Date, default: null })
  cancelledAt!: Date | null;

  @Prop({ type: String, default: null })
  transactionReference!: string | null;

  @Prop({ default: false })
  paymentConfirmed!: boolean;

  @Prop({ default: false })
  isMember!: boolean;

  @Prop({ type: Number, default: 0 })
  amount!: number;

  // M16: Sparse unique key preventing concurrent active requests per user
  @Prop({ type: String, default: null })
  activeRequestKey!: string | null;
}

export const ArphaRequestSchema = SchemaFactory.createForClass(ArphaRequest);

ArphaRequestSchema.index({ userId: 1, createdAt: -1 });
// M16: Sparse unique index ensures only one active request per user
ArphaRequestSchema.index(
  { activeRequestKey: 1 },
  { unique: true, sparse: true },
);
