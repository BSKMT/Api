import {
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  IsBoolean,
  IsArray,
  MinLength,
  MaxLength,
  Min,
  Max,
} from "class-validator";
import {
  CourseLevel,
  CourseFormat,
  CourseStatus,
} from "../../events/schemas/course.schema";

export class UpdateCourseDto {
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

  @IsEnum(CourseLevel)
  @IsOptional()
  level?: CourseLevel;

  @IsEnum(CourseFormat)
  @IsOptional()
  format?: CourseFormat;

  @IsString()
  @IsOptional()
  icon?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  heroImage?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  durationHours?: number;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  modules?: string[];

  @IsBoolean()
  @IsOptional()
  membersFree?: boolean;

  @IsNumber()
  @Min(0)
  @IsOptional()
  nonMemberPrice?: number;

  // A8: @Max(100) prevents negative checkout totals
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  memberSemipresencialDiscount?: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  memberPresencialDiscount?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  maxCapacity?: number;

  @IsEnum(CourseStatus)
  @IsOptional()
  status?: CourseStatus;

  @IsBoolean()
  @IsOptional()
  featured?: boolean;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  featuresIncluded?: string[];
}
