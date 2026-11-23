import { IsOptional, IsString, Matches, MaxLength } from "class-validator";

export class VerifyRuntDto {
  @IsOptional()
  @IsString()
  @MaxLength(30)
  documentType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  @Matches(/^[A-Za-z0-9.-]*$/, {
    message: "El número de documento contiene caracteres no permitidos",
  })
  documentNumber?: string;
}
