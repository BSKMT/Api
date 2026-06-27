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

export class CreateEventDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  slug: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  subtitle: string;

  @IsDateString()
  date: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;

  @IsString()
  location: string;

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
}
