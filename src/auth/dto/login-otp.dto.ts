import {
  IsString,
  IsNotEmpty,
  IsEmail,
  IsBoolean,
  IsOptional,
  MaxLength,
  Matches,
} from "class-validator";

export class LoginOtpInitiateDto {
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password!: string;

  @IsBoolean()
  @IsOptional()
  rememberMe?: boolean;

  @IsString()
  @IsOptional()
  turnstileToken?: string;
}

/**
 * DTO para inicio de sesión en BSK Fascia (Colaboradores / Operaciones).
 * Requisito: Nombre de Usuario + Contraseña.
 */
export class LoginOtpFasciaInitiateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  username!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password!: string;

  @IsBoolean()
  @IsOptional()
  rememberMe?: boolean;

  @IsString()
  @IsOptional()
  turnstileToken?: string;
}

/**
 * DTO para inicio de sesión en BSK Console (Administración Ejecutiva).
 * Requisito Cuádruple: Correo Electrónico + Nombre de Usuario + Contraseña + OTP.
 */
export class LoginOtpConsoleInitiateDto {
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  username!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password!: string;

  @IsBoolean()
  @IsOptional()
  rememberMe?: boolean;

  @IsString()
  @IsOptional()
  turnstileToken?: string;
}

/**
 * DTO para inicio de sesión en BSK Superadmin (Dueños y Propietarios).
 * Requisito: Correo Electrónico + Nombre de Usuario + Contraseña + OTP.
 */
export class LoginOtpSuperAdminInitiateDto {
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  username!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password!: string;

  @IsBoolean()
  @IsOptional()
  rememberMe?: boolean;

  @IsString()
  @IsOptional()
  turnstileToken?: string;
}


/**
 * DTO para verificar el codigo OTP de login.
 *
 * Con Bird Verify el codigo es numerico (4 a 8 digitos — Bird Workspace
 * default es 6). Se valida el formato en el DTO ademas de en el frontend
 * para impedir envios obviamente invalidos al proveedor (OWASP A05:2025 —
 * Injection / Input Validation, A07:2025 — Anti brute force).
 */
export class LoginOtpVerifyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  requestId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(8)
  @Matches(/^\d{4,8}$/, {
    message: "El código debe ser numérico de 4 a 8 dígitos.",
  })
  code!: string;
}
