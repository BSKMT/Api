import { IsEmail, IsString, IsIn, MinLength, MaxLength } from "class-validator";

export class B2bContactDto {
  @IsString({ message: "El nombre de la empresa debe ser texto" })
  @MinLength(2, {
    message: "El nombre de la empresa debe tener al menos 2 caracteres",
  })
  @MaxLength(100, {
    message: "El nombre de la empresa no puede exceder 100 caracteres",
  })
  companyName: string;

  @IsString({ message: "El nombre de contacto debe ser texto" })
  @MinLength(2, {
    message: "El nombre de contacto debe tener al menos 2 caracteres",
  })
  @MaxLength(100, {
    message: "El nombre de contacto no puede exceder 100 caracteres",
  })
  contactName: string;

  @IsEmail({}, { message: "Correo electronico invalido" })
  email: string;

  @IsString({ message: "El tipo de alianza debe ser texto" })
  @IsIn(
    [
      "Patrocinio",
      "Marca compartida",
      "Intercambio de datos",
      "Activación de marca",
      "Otro",
    ],
    { message: "Tipo de alianza invalido" },
  )
  interest: string;

  @IsString({ message: "El mensaje debe ser texto" })
  @MinLength(10, { message: "El mensaje debe tener al menos 10 caracteres" })
  @MaxLength(2000, { message: "El mensaje no puede exceder 2000 caracteres" })
  message: string;
}
