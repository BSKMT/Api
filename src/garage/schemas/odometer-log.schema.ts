import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document } from "mongoose";

export type OdometerLogDocument = OdometerLog & Document;

export enum OdometerSource {
  MANUAL_QUICK = "manual_quick",
  RIDE_CHECKIN = "ride_checkin",
  SERVICE_ORDER = "service_order",
}

@Schema({ timestamps: true, collection: "garage_odometer_logs" })
export class OdometerLog {
  @Prop({ required: true, index: true })
  userId!: string;

  @Prop({ required: true, index: true })
  motorcycleId!: string;

  @Prop({ required: true })
  odometerKm!: number;

  @Prop({ required: true, default: () => new Date() })
  recordedAt!: Date;

  @Prop({
    required: true,
    enum: Object.values(OdometerSource),
    default: OdometerSource.MANUAL_QUICK,
  })
  source!: OdometerSource;

  @Prop({ type: String, default: null })
  referenceId!: string | null;
}

export const OdometerLogSchema = SchemaFactory.createForClass(OdometerLog);

OdometerLogSchema.index({ motorcycleId: 1, recordedAt: -1 });
OdometerLogSchema.index({ userId: 1, recordedAt: -1 });
