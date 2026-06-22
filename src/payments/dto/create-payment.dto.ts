import { IsString, IsIn, IsOptional } from "class-validator";

export class CreatePaymentDto {
  @IsString()
  eventSlug: string;

  @IsString()
  @IsIn([
    "member-solo",
    "member-companion",
    "non-member-solo",
    "non-member-companion",
  ])
  tier: string;

  @IsString()
  @IsOptional()
  productSlug?: string;
}
