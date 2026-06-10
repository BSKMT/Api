import { IsString, IsIn, IsBoolean, IsOptional } from "class-validator";

export class CreateMembershipPaymentDto {
  @IsString()
  @IsIn(["single", "installment"])
  paymentPlan: string;

  @IsBoolean()
  @IsOptional()
  isRenewal?: boolean;
}
