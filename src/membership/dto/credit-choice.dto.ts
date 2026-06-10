import { IsString, IsIn } from "class-validator";

export class CreditChoiceDto {
  @IsString()
  @IsIn(["membership", "services", "refund"])
  choice: string;
}
