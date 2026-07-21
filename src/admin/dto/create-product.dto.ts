import {
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  IsInt,
  IsBoolean,
  MinLength,
  MaxLength,
  Min,
  Max,
} from "class-validator";
import { ProductStatus } from "../../shop/schemas/product.schema";

export class CreateProductDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  slug!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  @IsString()
  collection!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  image?: string;

  @IsNumber()
  @Min(0)
  publicPrice!: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  memberDiscountPercent?: number;

  @IsNumber()
  @Min(0)
  @IsInt()
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
