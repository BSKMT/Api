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
 * a través de Better Auth (server-to-server). Si las credenciales son válidas,
 * se genera un código alfanumérico de 6 caracteres, se guarda este colección
 * junto con el token de sesión capturado y se envía el código por correo
 * electrónico al usuario. La sesión NO se envía al cliente hasta que el
 * código sea verificado.
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

  /** Código alfanumérico de 6 caracteres (hashed con SHA-256). */
  @Prop({ type: String, required: true })
  codeHash!: string;

  /** Cookies de sesión capturadas de Better Auth (JSON serializado). */
  @Prop({ type: String, required: true })
  sessionCookies!: string;

  /** Estado actual del OTP. */
  @Prop({ type: String, required: true, default: "pending", index: true })
  status!: LoginOtpStatus;

  /** Número de intentos fallidos de verificación. */
  @Prop({ type: Number, required: true, default: 0 })
  attempts!: number;

  /** Fecha de expiración del OTP (5 minutos tras su creación). */
  @Prop({ type: Date, required: true, expires: 360 })
  expiresAt!: Date;
}

export type LoginOtpDocument = HydratedDocument<LoginOtp>;
export const LoginOtpSchema = SchemaFactory.createForClass(LoginOtp);
