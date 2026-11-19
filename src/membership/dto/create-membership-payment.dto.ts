import {
  IsString,
  IsIn,
  IsBoolean,
  IsOptional,
  IsInt,
  Min,
} from "class-validator";

export class CreateMembershipPaymentDto {
  @IsString()
  @IsIn(["single", "installment"])
  paymentPlan!: string;

  @IsBoolean()
  @IsOptional()
  isRenewal?: boolean;

  @IsBoolean()
  @IsOptional()
  useCredit?: boolean;

  @IsInt()
  @Min(0)
  @IsOptional()
  creditAmount?: number;
}
