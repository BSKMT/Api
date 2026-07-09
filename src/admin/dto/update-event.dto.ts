import {
  IsString,
  IsDateString,
  IsOptional,
  IsEnum,
  IsNumber,
  IsBoolean,
  IsArray,
  MinLength,
  MaxLength,
  Min,
} from "class-validator";
import { EventCategory, EventStatus } from "../../events/schemas/event.schema";

export class UpdateEventDto {
  // A-7: slug removed — slug is the identifier, cannot be changed via update
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  @IsOptional()
  title?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  @IsOptional()
  subtitle?: string;

  @IsDateString()
  @IsOptional()
  date?: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;

  @IsString()
  @IsOptional()
  location?: string;

  @IsString()
  @IsOptional()
  meetingPoint?: string;

  @IsString()
  @IsOptional()
  meetingTime?: string;

  @IsString()
  @IsOptional()
  departureTime?: string;

  @IsEnum(EventCategory)
  @IsOptional()
  category?: EventCategory;

  @IsString()
  @IsOptional()
  tag?: string;

  @IsString()
  @IsOptional()
  icon?: string;

  @IsString()
  @IsOptional()
  difficulty?: string;

  @IsString()
  @IsOptional()
  duration?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  heroImage?: string;

  @IsString()
  @IsOptional()
  heroImageAvif?: string;

  @IsBoolean()
  @IsOptional()
  membersFree?: boolean;

  @IsNumber()
  @Min(0)
  @IsOptional()
  nonMemberPrice?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  companionPrice?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  maxCapacity?: number;

  @IsEnum(EventStatus)
  @IsOptional()
  status?: EventStatus;

  @IsBoolean()
  @IsOptional()
  featured?: boolean;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  featuresIncluded?: string[];

  @IsString()
  @IsOptional()
  memberDetails?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  memberFeatures?: string[];

  @IsString()
  @IsOptional()
  paidUserDetails?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  paidUserFeatures?: string[];

  @IsString()
  @IsOptional()
  autogestionadoDetails?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  autogestionadoFeatures?: string[];
}
