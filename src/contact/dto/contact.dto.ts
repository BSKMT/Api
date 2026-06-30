import { IsEmail, IsString, MinLength, MaxLength } from "class-validator";

/**
 * ContactDto - Datos del formulario de contacto publico de la landing page.
 * El endpoint envia un correo interno al equipo BSK y una auto-respuesta
 * al remitente.
 */
export class ContactDto {
  @IsString({ message: "El nombre debe ser texto" })
  @MinLength(2, { message: "El nombre debe tener al menos 2 caracteres" })
  @MaxLength(100, { message: "El nombre no puede exceder 100 caracteres" })
  name: string;

  @IsEmail({}, { message: "Correo electronico invalido" })
  email: string;

  @IsString({ message: "El asunto debe ser texto" })
  @MinLength(3, { message: "El asunto debe tener al menos 3 caracteres" })
  @MaxLength(150, { message: "El asunto no puede exceder 150 caracteres" })
  subject: string;

  @IsString({ message: "El mensaje debe ser texto" })
  @MinLength(10, { message: "El mensaje debe tener al menos 10 caracteres" })
  @MaxLength(2000, { message: "El mensaje no puede exceder 2000 caracteres" })
  message: string;
}
