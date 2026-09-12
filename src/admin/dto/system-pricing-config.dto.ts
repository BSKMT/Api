import {
  IsNumber,
  IsString,
  IsBoolean,
  IsOptional,
  IsArray,
  ValidateNested,
  Min,
  Max,
  IsDateString,
} from "class-validator";
import { Type } from "class-transformer";

export class MembershipPricingDto {
  @IsNumber()
  @Min(0)
  renewalAmount!: number;

  @IsNumber()
  @Min(0)
  newMemberAmount!: number;

  @IsNumber()
  @Min(0)
  installmentAmount!: number;

  @IsNumber()
  @Min(1)
  installmentsTotal!: number;

  @IsNumber()
  @Min(30)
  durationDays!: number;
}

export class CampaignDto {
  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsNumber()
  @Min(1)
  lotMinCapacity!: number;

  @IsNumber()
  @Min(1)
  lotMaxCapacity!: number;

  @IsNumber()
  @Min(0)
  earlyBirdBonusAmount!: number;

  @IsNumber()
  @Min(0)
  earlyBirdDays!: number;

  @IsBoolean()
  isActive!: boolean;
}

export class ArphaPricingDto {
  @IsNumber()
  @Min(0)
  tecnica!: number;

  @IsNumber()
  @Min(0)
  ruta!: number;

  @IsNumber()
  @Min(0)
  emergencia!: number;

  @IsNumber()
  @Min(0)
  juridica!: number;
}

export class PerksAndRatesDto {
  @IsNumber()
  @Min(0)
  officialKitPrice!: number;

  @IsNumber()
  @Min(0)
  annualGalaTicketPrice!: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  shopMemberDiscountPercent!: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  courseVirtualDiscountPercent!: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  coursePresencialDiscountPercent!: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  courseSemipresencialDiscountPercent!: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  eventRodadaDiscountPercent!: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  eventMediumDiscountPercent!: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  eventExpeditionDiscountPercent!: number;

  @ValidateNested()
  @Type(() => ArphaPricingDto)
  arphaPricing!: ArphaPricingDto;
}

export class ComparisonRowDto {
  @IsString()
  service!: string;

  @IsString()
  registeredUser!: string;

  @IsString()
  legendRenewal!: string;

  @IsString()
  legendNew!: string;
}

export class TierFeaturesDto {
  @IsArray()
  @IsString({ each: true })
  freeTierFeatures!: string[];

  @IsArray()
  @IsString({ each: true })
  legendTierFeatures!: string[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ComparisonRowDto)
  comparisonTable!: ComparisonRowDto[];
}

export class UpdateSystemPricingConfigDto {
  @IsNumber()
  @Min(2025)
  @Max(2100)
  seasonYear!: number;

  @IsBoolean()
  @IsOptional()
  isCurrentSeason?: boolean;

  @ValidateNested()
  @Type(() => MembershipPricingDto)
  membership!: MembershipPricingDto;

  @ValidateNested()
  @Type(() => CampaignDto)
  campaign!: CampaignDto;

  @ValidateNested()
  @Type(() => PerksAndRatesDto)
  perksAndRates!: PerksAndRatesDto;

  @ValidateNested()
  @Type(() => TierFeaturesDto)
  features!: TierFeaturesDto;
}
