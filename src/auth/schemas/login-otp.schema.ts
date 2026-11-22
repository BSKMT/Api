import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument } from "mongoose";
import type { AuthPortal } from "../better-auth.types";

/**
 * Estado del OTP de login:
 * - `pending`   — Bird Verify envio el codigo, esperando verificacion.
 * - `verified`  — codigo verificado correctamente, sesion entregada.
 * - `expired`   — Bird rechazo (expired / failed / no-config) o cleanup.
 */
export type LoginOtpStatus = "pending" | "verified" | "expired";

/**
 * Documento OTP de login almacenado en MongoDB.
 *
 * A diferencia del sistema anterior (donde se generaba, hasheaba y comparaba
 * el codigo localmente), Bird Verify genera, entrega, hashea y verifica el
 * codigo — la app nunca maneja el codigo en texto plano. Este documento solo
 * persiste el puente entre el `requestId` (公开 para el cliente) y las
 * cookies de sesion de Better Auth **cifradas con AES-256-GCM**, mas el email
 * del destinatario (necesario para el `check` de Bird, que se identifica por
 * el mismo `to`).
 *
 * Seguridad (OWASP A04:2025 — Cryptographic Failures):
 *  - Las cookies de sesion NO se almacenan raw; se cifran con AES-256-GCM
 *    (server key derivada via scrypt de BETTER_AUTH_SECRET). Un breach de
 *    solo BD no las revela.
 *  - El codigo OTP nunca se guarda (ni en hash local) — Bird es el unico
 *    repositorio del hash.
 *  - TTL de 1 hora como red de seguridad de cleanup; Bird ya enforce su
 *    propio `expires_at` (default 10 min) sobre el ciclo de vida del codigo.
 */
@Schema({ timestamps: true, collection: "loginOtp" })
export class LoginOtp {
  /** Identificador publico del OTP (random 16 bytes hex) enviado al cliente. */
  @Prop({ type: String, required: true, unique: true, index: true })
  requestId!: string;

  /**
   * Email del usuario que solicita el login (minusculas).
   * Se almacena para poder llamar a Bird `check` con el mismo `to.email`
   * usado en el `create` (Bird identifica la verificacion por el destinatario).
   */
  @Prop({ type: String, required: true, index: true })
  email!: string;

  /** ID del usuario en Better Auth (para correlacion / auditoria). */
  @Prop({ type: String, required: true })
  betterAuthId!: string;

  /**
   * ID de verificacion retornado por Bird (formato `vrf_...`).
   * Opcional — se almacena solo si el `create` tuvo exito, para correlacionar
   * con el dashboard de Bird y para depuracion.
   */
  @Prop({ type: String, required: false })
  birdVerificationId?: string;

  /**
   * Cookies de sesion capturadas de Better Auth, **cifradas con AES-256-GCM**
   * (formato `iv:tag:ciphertext`). Sin la server key derivada de
   * BETTER_AUTH_SECRET, un atacante con acceso de lectura a la BD no puede
   * obtener las cookies validas (OWASP A04:2025).
   */
  @Prop({ type: String, required: true })
  sessionCookies!: string;

  /** Estado actual del OTP. */
  @Prop({ type: String, required: true, default: "pending", index: true })
  status!: LoginOtpStatus;

  /**
   * Portal de autenticación desde el cual se inició el flujo OTP.
   * Permite sesiones aisladas por portal (standard vs fascia/console/superadmin).
   */
  @Prop({ type: String, required: false, default: "standard" })
  authPortal?: AuthPortal;

  /**
   * Numero de intentos fallidos de verificacion registrados localmente.
   * Bird lleva su propio contador de `attempts_remaining`, pero este campo
   * se mantiene para telemetria, logs y como respaldo en caso de que Bird
   * devuelva `attempts_remaining` nulo.
   */
  @Prop({ type: Number, required: true, default: 0 })
  attempts!: number;

  @Prop({ type: Number, required: true, default: 0 })
  resendCount!: number;

  @Prop({ type: Date, required: false, default: null })
  lastResentAt?: Date | null;

  /**
   * Fecha de expiracion del documento (cleanup exacto en `expiresAt`).
   */
  @Prop({ type: Date, required: true, expires: 0 })
  expiresAt!: Date;
}

export type LoginOtpDocument = HydratedDocument<LoginOtp>;
export const LoginOtpSchema = SchemaFactory.createForClass(LoginOtp);
