import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument } from "mongoose";

/**
 * Estado del OTP de login:
 * - `pending`   — código enviado, esperando verificación.
 * - `verified`  — código verificado correctamente, sesión entregada.
 * - `expired`   — expiró sin verificación o superado el máximo de intentos.
 */
export type LoginOtpStatus = "pending" | "verified" | "expired";

/**
 * Documento OTP de login almacenado en MongoDB.
 *
 * Cuando un usuario intenta iniciar sesión, se valida su email y contraseña
 * a través de Better Auth (en proceso). Si las credenciales son válidas, se
 * genera un código alfanumérico de 6 caracteres, se guarda en esta colección
 * (hasheado con HMAC-SHA-256 + server key) junto con las cookies de sesión
 * **cifradas con AES-256-GCM**, y se envía el código por correo electrónico
 * al usuario. La sesión NO se envía al cliente hasta que el código sea
 * verificado.
 */
@Schema({ timestamps: true, collection: "loginOtp" })
export class LoginOtp {
  /** Identificador público del OTP (UUID) enviado al cliente. */
  @Prop({ type: String, required: true, unique: true, index: true })
  requestId!: string;

  /** Email del usuario que solicita el login. */
  @Prop({ type: String, required: true, index: true })
  email!: string;

  /** ID del usuario en Better Auth. */
  @Prop({ type: String, required: true })
  betterAuthId!: string;

  /**
   * Código alfanumérico de 6 caracteres hasheado con HMAC-SHA-256 + server
   * key (derivada de BETTER_AUTH_SECRET via scrypt). Sin la server key, un
   * atacante con acceso de lectura a la BD no puede brute-forcear el hash
   * offline (OWASP A04:2025, CWE-256/CWE-327).
   */
  @Prop({ type: String, required: true })
  codeHash!: string;

  /**
   * Cookies de sesión capturadas de Better Auth, **cifradas con AES-256-GCM**
   * (formato `iv:tag:ciphertext`). Sin la server key derivada de
   * BETTER_AUTH_SECRET, un atacante con acceso de lectura a la BD no puede
   * obtener las cookies válidas (OWASP A04:2025).
   */
  @Prop({ type: String, required: true })
  sessionCookies!: string;

  /** Estado actual del OTP. */
  @Prop({ type: String, required: true, default: "pending", index: true })
  status!: LoginOtpStatus;

  /** Número de intentos fallidos de verificación. */
  @Prop({ type: Number, required: true, default: 0 })
  attempts!: number;

  /** Fecha de expiración del OTP (5 minutos = 300 segundos tras su creación). */
  @Prop({ type: Date, required: true, expires: 300 })
  expiresAt!: Date;
}

export type LoginOtpDocument = HydratedDocument<LoginOtp>;
export const LoginOtpSchema = SchemaFactory.createForClass(LoginOtp);
