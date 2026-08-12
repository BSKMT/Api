import { IsString, IsNotEmpty, Matches, MaxLength } from "class-validator";

const E164_PATTERN = /^\+[1-9]\d{5,14}$/;

export class InitiatePhoneVerifyDto {
  @IsString()
  @IsNotEmpty()
  @Matches(E164_PATTERN, {
    message: "El telefono debe estar en formato E.164 (ej: +573001234567)",
  })
  @MaxLength(20)
  phone!: string;
}

export class CheckPhoneVerifyDto {
  @IsString()
  @IsNotEmpty()
  @Matches(E164_PATTERN, {
    message: "El telefono debe estar en formato E.164 (ej: +573001234567)",
  })
  @MaxLength(20)
  phone!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4,8}$/, {
    message: "El codigo debe ser numerico de 4 a 8 digitos",
  })
  @MaxLength(8)
  code!: string;
}

export class InitiateEmailChangeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(254)
  @Matches(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, {
    message: "El correo electronico no es valido",
  })
  newEmail!: string;
}

export class CheckEmailChangeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(254)
  @Matches(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, {
    message: "El correo electronico no es valido",
  })
  newEmail!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4,8}$/, {
    message: "El codigo debe ser numerico de 4 a 8 digitos",
  })
  @MaxLength(8)
  code!: string;
}
