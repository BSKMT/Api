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
    "course-member-virtual",
    "course-member-semipresencial",
    "course-member-presencial",
    "course-non-member",
    "arpha-tecnica",
    "arpha-emergencia",
    "arpha-juridica",
    "arpha-ruta",
  ])
  tier: string;

  @IsString()
  @IsOptional()
  productSlug?: string;

  @IsString()
  @IsOptional()
  relatedReference?: string;
}
