import {
  IsString,
  IsIn,
  IsNumber,
  Min,
  MaxLength,
  IsOptional,
} from "class-validator";

export class UseCreditDto {
  @IsString()
  @IsIn(["membership", "services"])
  creditSource!: string;

  @IsNumber()
  @Min(1)
  amount!: number;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;
}
