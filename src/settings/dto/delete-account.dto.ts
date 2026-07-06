import { IsString, IsOptional, IsBoolean } from "class-validator";

export class DeleteAccountDto {
  @IsString()
  @IsOptional()
  reason?: string;

  @IsBoolean()
  @IsOptional()
  confirm?: boolean;
}