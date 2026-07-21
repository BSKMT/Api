import {
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  IsBoolean,
  MinLength,
  MaxLength,
  Min,
  Max,
} from "class-validator";
import { ProductStatus } from "../../shop/schemas/product.schema";

export class UpdateProductDto {
  // A9: slug removed — slug is the identifier, cannot be changed via update
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  collection?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  image?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  publicPrice?: number;

  // A8: @Max(100) prevents negative checkout totals
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  memberDiscountPercent?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  stock?: number;

  @IsBoolean()
  @IsOptional()
  isNew?: boolean;

  @IsBoolean()
  @IsOptional()
  featured?: boolean;

  @IsEnum(ProductStatus)
  @IsOptional()
  status?: ProductStatus;
}