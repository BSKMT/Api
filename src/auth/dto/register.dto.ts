import { IsEmail, IsString, MinLength } from "class-validator";

export class RegisterDto {
  @IsEmail({}, { message: "Correo electronico invalido" })
  email!: string;

  @IsString()
  @MinLength(8, { message: "La contrasena debe tener al menos 8 caracteres" })
  password!: string;

  @IsString()
  @MinLength(8, {
    message: "La confirmacion de contrasena debe tener al menos 8 caracteres",
  })
  confirmPassword!: string;
}
