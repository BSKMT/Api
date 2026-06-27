import { IsString, IsOptional, MaxLength } from "class-validator";

export class RejectRefundDto {
  @IsString()
  @IsOptional()
  @MaxLength(500)
  reason?: string;
}
