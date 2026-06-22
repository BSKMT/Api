import { IsString, IsArray, ValidateNested, IsOptional } from "class-validator";
import { Type } from "class-transformer";

export class OrderItemDto {
  @IsString()
  productSlug: string;

  @IsString()
  productName: string;

  @IsString()
  unitPrice: string;

  @IsString()
  quantity: string;
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
