import {
  ArrayMaxSize,
  ArrayMinSize,
  IsString,
  IsArray,
  ValidateNested,
  IsOptional,
  IsInt,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { Type } from "class-transformer";

export class OrderItemDto {
  @IsString()
  @MaxLength(120)
  productSlug!: string;

  @IsInt()
  @Min(1)
  @Max(20)
  @Type(() => Number)
  quantity!: number;
}

export class CreateOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items!: OrderItemDto[];

  @IsString()
  @IsOptional()
  @MaxLength(500)
  shippingAddress?: string;
}
