import { IsString, IsIn, IsNumber, Min } from "class-validator";

export class UseCreditDto {
  @IsString()
  @IsIn(["membership", "services"])
  creditSource: string;

  @IsNumber()
  @Min(1)
  amount: number;

  @IsString()
  description?: string;
}
