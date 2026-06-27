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
} from "class-validator";
import {
  CourseLevel,
  CourseFormat,
  CourseStatus,
} from "../../events/schemas/course.schema";

export class CreateCourseDto {
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

  @IsNumber()
  @Min(0)
  @IsOptional()
  memberSemipresencialDiscount?: number;

  @IsNumber()
  @Min(0)
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
