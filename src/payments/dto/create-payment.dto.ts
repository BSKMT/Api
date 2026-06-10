import { IsString, IsIn } from "class-validator";

export class CreatePaymentDto {
  @IsString()
  @IsIn(["rrf-training-bskmt"])
  eventSlug: string;

  @IsString()
  @IsIn([
    "member-solo",
    "member-companion",
    "non-member-solo",
    "non-member-companion",
  ])
  tier: string;
}
