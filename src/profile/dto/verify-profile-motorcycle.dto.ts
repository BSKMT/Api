import { IsNotEmpty, IsOptional, IsString, MaxLength } from "class-validator";

export class VerifyProfileMotorcycleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  plate!: string;

  @IsString()
  @IsOptional()
  @MaxLength(30)
  documentNumber?: string;

  @IsString()
  @IsOptional()
  @MaxLength(10)
  documentType?: string;
}
