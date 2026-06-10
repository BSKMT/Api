import {
  IsString,
  IsIn,
  IsBoolean,
  IsOptional,
  IsNumber,
  Min,
} from "class-validator";

export class CreateMembershipPaymentDto {
  @IsString()
  @IsIn(["single", "installment"])
  paymentPlan: string;

  @IsBoolean()
  @IsOptional()
  isRenewal?: boolean;

  @IsBoolean()
  @IsOptional()
  useCredit?: boolean;

  @IsNumber()
  @Min(0)
  @IsOptional()
  creditAmount?: number;
}
