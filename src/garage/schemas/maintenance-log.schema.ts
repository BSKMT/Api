import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document } from "mongoose";

export type MaintenanceLogDocument = MaintenanceLog & Document;

export enum MaintenanceType {
  PREVENTIVE = "preventive",
  CORRECTIVE = "corrective",
  OIL_CHANGE = "oil_change",
  TIRES = "tires",
  CHAIN_KIT = "chain_kit",
  BRAKES = "brakes",
  GENERAL_OVERHAUL = "general_overhaul",
}

export enum MaintenanceSource {
  MANUAL_USER = "manual_user",
  PLATFORM_ORDER_AUTO = "platform_order_auto",
  ALLIED_CERTIFIED = "allied_certified",
}

@Schema({ timestamps: true, collection: "garage_maintenance_logs" })
export class MaintenanceLog {
  @Prop({ required: true, index: true })
  userId!: string;

  @Prop({ required: true, index: true })
  motorcycleId!: string;

  @Prop({ required: true, default: () => new Date() })
  date!: Date;

  @Prop({ required: true })
  odometerKm!: number;

  @Prop({
    required: true,
    enum: Object.values(MaintenanceType),
    default: MaintenanceType.PREVENTIVE,
  })
  maintenanceType!: MaintenanceType;

  @Prop({ required: true, trim: true })
  workshop!: string;

  @Prop({ type: [String], default: [] })
  partsChanged!: string[];

  @Prop({ type: String, default: null, trim: true })
  oilType!: string | null;

  @Prop({ required: true, default: 0 })
  cost!: number;

  @Prop({ type: String, default: null, trim: true })
  invoiceNumber!: string | null;

  @Prop({ type: String, default: "", trim: true })
  notes!: string;

  @Prop({ default: false })
  isAlliedVerified!: boolean;

  @Prop({ type: String, default: null, trim: true })
  alliedWorkshopName!: string | null;

  @Prop({ type: String, default: null, trim: true })
  alliedVerificationCode!: string | null;

  @Prop({ type: Date, default: null })
  alliedVerifiedAt!: Date | null;

  @Prop({
    required: true,
    enum: Object.values(MaintenanceSource),
    default: MaintenanceSource.MANUAL_USER,
  })
  source!: MaintenanceSource;
}

export const MaintenanceLogSchema =
  SchemaFactory.createForClass(MaintenanceLog);

MaintenanceLogSchema.index({ userId: 1, motorcycleId: 1, date: -1 });
MaintenanceLogSchema.index({ motorcycleId: 1, maintenanceType: 1 });
