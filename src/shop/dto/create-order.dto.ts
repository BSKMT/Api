import {
  IsString,
  IsArray,
  ValidateNested,
  IsOptional,
  IsInt,
  Min,
} from "class-validator";
import { Type } from "class-transformer";

export class OrderItemDto {
  @IsString()
  productSlug: string;

  @IsInt()
  @Min(1)
  @Type(() => Number)
  quantity: number;
}

export class CreateOrderDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];

  @IsString()
  @IsOptional()
  shippingAddress?: string;
}
