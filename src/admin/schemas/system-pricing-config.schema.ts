import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document } from "mongoose";

export type SystemPricingConfigDocument = SystemPricingConfig & Document;

@Schema({ _id: false })
export class MembershipPricingConfig {
  @Prop({ required: true, default: 3050000 })
  renewalAmount!: number;

  @Prop({ required: true, default: 3250000 })
  newMemberAmount!: number;

  @Prop({ required: true, default: 300000 })
  installmentAmount!: number;

  @Prop({ required: true, default: 12 })
  installmentsTotal!: number;

  @Prop({ required: true, default: 365 })
  durationDays!: number;
}

@Schema({ _id: false })
export class CampaignConfig {
  @Prop({ required: true, default: "2027-01-10T00:00:00.000Z" })
  startDate!: string;

  @Prop({ required: true, default: "2027-01-31T23:59:59.000Z" })
  endDate!: string;

  @Prop({ required: true, default: 150 })
  lotMinCapacity!: number;

  @Prop({ required: true, default: 200 })
  lotMaxCapacity!: number;

  @Prop({ required: true, default: 150000 })
  earlyBirdBonusAmount!: number;

  @Prop({ required: true, default: 5 })
  earlyBirdDays!: number;

  @Prop({ required: true, default: true })
  isActive!: boolean;
}

@Schema({ _id: false })
export class ArphaPricingConfig {
  @Prop({ required: true, default: 55000 })
  tecnica!: number;

  @Prop({ required: true, default: 85000 })
  ruta!: number;

  @Prop({ required: true, default: 145000 })
  emergencia!: number;

  @Prop({ required: true, default: 195000 })
  juridica!: number;
}

@Schema({ _id: false })
export class PerksAndRatesConfig {
  @Prop({ required: true, default: 580000 })
  officialKitPrice!: number;

  @Prop({ required: true, default: 280000 })
  annualGalaTicketPrice!: number;

  @Prop({ required: true, default: 15 })
  shopMemberDiscountPercent!: number;

  @Prop({ required: true, default: 100 })
  courseVirtualDiscountPercent!: number;

  @Prop({ required: true, default: 20 })
  coursePresencialDiscountPercent!: number;

  @Prop({ required: true, default: 25 })
  courseSemipresencialDiscountPercent!: number;

  @Prop({ required: true, default: 100 })
  eventRodadaDiscountPercent!: number;

  @Prop({ required: true, default: 25 })
  eventMediumDiscountPercent!: number;

  @Prop({ required: true, default: 20 })
  eventExpeditionDiscountPercent!: number;

  @Prop({ type: ArphaPricingConfig, required: true, default: () => ({}) })
  arphaPricing!: ArphaPricingConfig;
}

@Schema({ _id: false })
export class ComparisonRow {
  @Prop({ required: true })
  service!: string;

  @Prop({ required: true })
  registeredUser!: string;

  @Prop({ required: true })
  legendRenewal!: string;

  @Prop({ required: true })
  legendNew!: string;
}

@Schema({ _id: false })
export class TierFeaturesConfig {
  @Prop({ type: [String], required: true, default: [] })
  freeTierFeatures!: string[];

  @Prop({ type: [String], required: true, default: [] })
  legendTierFeatures!: string[];

  @Prop({ type: [ComparisonRow], required: true, default: [] })
  comparisonTable!: ComparisonRow[];
}

@Schema({ timestamps: true, collection: "system_pricing_configs" })
export class SystemPricingConfig {
  @Prop({ required: true, unique: true, default: 2027 })
  seasonYear!: number;

  @Prop({ required: true, default: true })
  isCurrentSeason!: boolean;

  @Prop({ type: MembershipPricingConfig, required: true, default: () => ({}) })
  membership!: MembershipPricingConfig;

  @Prop({ type: CampaignConfig, required: true, default: () => ({}) })
  campaign!: CampaignConfig;

  @Prop({ type: PerksAndRatesConfig, required: true, default: () => ({}) })
  perksAndRates!: PerksAndRatesConfig;

  @Prop({ type: TierFeaturesConfig, required: true, default: () => ({}) })
  features!: TierFeaturesConfig;

  @Prop({ type: String, default: null })
  updatedBy!: string | null;
}

export const SystemPricingConfigSchema =
  SchemaFactory.createForClass(SystemPricingConfig);

SystemPricingConfigSchema.index({ isCurrentSeason: 1 });
SystemPricingConfigSchema.index({ seasonYear: 1 }, { unique: true });
