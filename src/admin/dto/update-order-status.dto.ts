import { IsEnum, IsOptional, IsString, MaxLength } from "class-validator";
import { OrderStatus } from "../../shop/schemas/order.schema";

export class UpdateOrderStatusDto {
  @IsEnum(OrderStatus)
  status: OrderStatus;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  trackingNumber?: string;
}
