import {
  IsEnum,
  IsInt,
  IsOptional,
  IsDateString,
  Min,
  Max,
} from "class-validator";

export class ExtendMembershipDto {
  @IsEnum(["days", "months", "years"])
  unit: "days" | "months" | "years";

  @IsInt()
  @Min(1)
  @Max(10)
  @IsOptional()
  amount?: number;

  @IsOptional()
  @IsDateString()
  baseDate?: string;
}
