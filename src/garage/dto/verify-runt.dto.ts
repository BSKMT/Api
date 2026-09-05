import { IsOptional, IsString } from "class-validator";

export class VerifyRuntDto {
  @IsOptional()
  @IsString()
  documentType?: string;

  @IsOptional()
  @IsString()
  documentNumber?: string;
}
