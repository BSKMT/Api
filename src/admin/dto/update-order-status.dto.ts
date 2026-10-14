import { IsEnum, IsOptional, IsString, MaxLength } from "class-validator";
import { Transform } from "class-transformer";
import { OrderStatus } from "../../shop/schemas/order.schema";

export class UpdateOrderStatusDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.toUpperCase().trim() : value,
  )
  @IsEnum(OrderStatus)
  status!: OrderStatus;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  trackingNumber?: string;
}
