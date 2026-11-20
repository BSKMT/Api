import {
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

export class LookupPlateDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(4)
  @MaxLength(12)
  @Matches(/^[A-Za-z0-9-]+$/, {
    message: "La placa solo puede contener letras, números y guiones",
  })
  plate!: string;
}
