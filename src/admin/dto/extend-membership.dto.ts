import {
  IsIn,
  IsInt,
  IsOptional,
  IsDateString,
  Min,
  Max,
} from "class-validator";

export class ExtendMembershipDto {
  @IsIn(["day", "days", "month", "months", "year", "years"])
  unit!: "day" | "days" | "month" | "months" | "year" | "years";

  @IsInt()
  @Min(1)
  @Max(10)
  @IsOptional()
  amount?: number;

  @IsOptional()
  @IsDateString()
  baseDate?: string;
}
