import {
  IsEmail,
  IsString,
  MinLength,
  MaxLength,
  IsOptional,
} from "class-validator";

/**
 * ContactDto - Datos del formulario de contacto publico de la landing page.
 * El endpoint envia un correo interno al equipo BSK y una auto-respuesta
 * al remitente.
 */
export class ContactDto {
  @IsString({ message: "El nombre debe ser texto" })
  @MinLength(2, { message: "El nombre debe tener al menos 2 caracteres" })
  @MaxLength(100, { message: "El nombre no puede exceder 100 caracteres" })
  name!: string;

  @IsEmail({}, { message: "Correo electronico invalido" })
  email!: string;

  @IsString({ message: "El asunto debe ser texto" })
  @MinLength(3, { message: "El asunto debe tener al menos 3 caracteres" })
  @MaxLength(150, { message: "El asunto no puede exceder 150 caracteres" })
  subject!: string;

  @IsString({ message: "El mensaje debe ser texto" })
  @MinLength(10, { message: "El mensaje debe tener al menos 10 caracteres" })
  @MaxLength(2000, { message: "El mensaje no puede exceder 2000 caracteres" })
  message!: string;

  /**
   * M-8: Cloudflare Turnstile token (or equivalent CAPTCHA proof).
   * Required when the `TURNSTILE_SECRET_KEY` env var is configured;
   * verified server-side via the siteverify endpoint. Optional so the
   * field stays backwards-compatible during rollout — the frontend
   * Astro page must include the Turnstile widget before flipping the
   * env switch on.
   */
  @IsString()
  @IsOptional()
  @MinLength(10)
  @MaxLength(4096)
  captchaToken?: string;
}
