import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document } from "mongoose";

export type GarageMotorcycleDocument = GarageMotorcycle & Document;

export enum UsageProfile {
  DAILY_URBAN = "daily_urban",
  WEEKEND_TRIPS = "weekend_trips",
  OFF_ROAD = "off_road",
  CIRCUIT = "circuit",
}

@Schema({ timestamps: true, collection: "garage_motorcycles" })
export class GarageMotorcycle {
  @Prop({ required: true, index: true })
  userId!: string;

  @Prop({ required: true, trim: true })
  brand!: string;

  @Prop({ required: true, trim: true })
  modelLine!: string;

  @Prop({ required: true })
  year!: number;

  @Prop({ required: true })
  displacementCc!: number;

  @Prop({ required: true, uppercase: true, trim: true })
  plate!: string;

  @Prop({ type: String, default: null, trim: true })
  vinOrEngineNumber!: string | null;

  @Prop({ type: String, default: null, trim: true })
  nickname!: string | null;

  @Prop({ type: String, default: "Negro", trim: true })
  color!: string;

  @Prop({ type: String, default: "Naked", trim: true })
  motorcycleType!: string;

  @Prop({
    required: true,
    enum: Object.values(UsageProfile),
    default: UsageProfile.DAILY_URBAN,
  })
  usageProfile!: UsageProfile;

  @Prop({ required: true, default: 0 })
  currentOdometerKm!: number;

  @Prop({ type: Date, default: () => new Date() })
  odometerLastUpdatedAt!: Date;

  @Prop({ type: Date, default: null })
  soatExpiryDate!: Date | null;

  @Prop({ type: Date, default: null })
  rtmExpiryDate!: Date | null;

  @Prop({ type: Date, default: null })
  licenseExpiryDate!: Date | null;

  @Prop({ type: String, default: null })
  insuranceCompany!: string | null;

  @Prop({ type: String, default: null })
  policyNumber!: string | null;

  @Prop({ default: true })
  isPrimary!: boolean;

  @Prop({ default: false })
  isRuntVerified!: boolean;

  @Prop({ type: Date, default: null })
  runtVerifiedAt!: Date | null;

  @Prop({ type: String, default: null })
  runtCdaName!: string | null;

  @Prop({ type: String, default: null })
  runtSoatStatus!: string | null;

  @Prop({ type: String, default: null })
  runtRtmStatus!: string | null;

  @Prop({ type: String, default: null })
  runtDocumentHolder!: string | null;
}

export const GarageMotorcycleSchema =
  SchemaFactory.createForClass(GarageMotorcycle);

GarageMotorcycleSchema.index({ userId: 1, isPrimary: -1 });
GarageMotorcycleSchema.index({ userId: 1, plate: 1 }, { unique: true });
