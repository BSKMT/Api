import { Injectable, Logger } from "@nestjs/common";

/**
 * BirdService — Proveedor compartido del cliente Bird SDK
 * (`@messagebird/sdk`).
 *
 * Centraliza la carga perezosa (dynamic import) y el cacheo del
 * `BirdClient` para que todos los servicios Bird (email, SMS, verify)
 * compartan una sola instancia del cliente y una sola API key.
 *
 * El SDK se publica como ESM puro (`"type": "module"`); la API NestJS se
 * compila a CommonJS. Importarlo estaticamente resultaria en
 * `ERR_REQUIRE_ESM` en runtime, asi que el cliente se carga con
 * `await import("@messagebird/sdk")` y se cachea en una promesa lazy
 * — el mismo patron usado por `better-auth.ts`.
 *
 * Seguridad (OWASP A04:2025 — Cryptographic Failures, A07:2025 —
 * Authentication Failures):
 *
 *  - La API key vive en `BIRD_API_KEY` (env), nunca en el codigo.
 *  - Bird inyecta `Idempotency-Key` en cada mutacion — los reintentos
 *    no duplican envios.
 *  - El SDK enforce retries con jittered exponential backoff en
 *    transitorios (429, 5xx) y nunca retira deterministicos (4xx).
 *  - Si la key no esta configurada, `isConfigured()` devuelve false y
 *    `getClient()` lanza un error generico sin exponer el estado interno.
 */

/** Tipo del modulo ESM `@messagebird/sdk` tras el dynamic import. */
export interface BirdSdkModule {
  BirdClient: new (opts: { apiKey: string }) => unknown;
}

/**
 * Cliente Bird tipado con la superficie que los servicios usan:
 *  - `email.send()`  — envio de correos transaccionales
 *  - `sms.send()`    — envio de mensajes SMS
 *  - `verify.verifications.create/check` — OTP de login
 *
 * Estos interfaces son una "ventana" minima sobre el BirdClient real
 * (que tiene tipos genericos muy profundos del SDK). El BirdClient se
 * construye y se asigna via `unknown` (double-cast) para evitar
 * problemas de compatibilidad de tipos del SDK ESM.
 */
export interface BirdClientInstance {
  readonly email: {
    send: (params: BirdEmailSendParams) => Promise<BirdEmailMessage>;
  };
  readonly sms: {
    send: (params: BirdSmsSendParams) => Promise<BirdSmsMessage>;
  };
  readonly verify: {
    readonly verifications: {
      create: (
        params: BirdVerifyCreateParams,
      ) => Promise<BirdVerificationResponse>;
      check: (
        params: BirdVerifyCheckParams,
      ) => Promise<BirdVerificationCheckResult>;
    };
  };
}

// ── Email ──────────────────────────────────────────────────────────

/** Parametros para enviar un correo via Bird Email API. */
export interface BirdEmailSendParams {
  from: string | { email: string; name?: string };
  to: string[];
  subject: string;
  html?: string;
  text?: string;
  category?: "transactional" | "marketing";
  reply_to?: string[];
  tags?: { name: string; value: string }[];
  metadata?: Record<string, unknown>;
  track_opens?: boolean;
  track_clicks?: boolean;
}

/** Respuesta de Bird Email (`202 Accepted`). */
export interface BirdEmailMessage {
  readonly id: string;
  readonly status: string;
  from: { email: string; name?: string };
  to: { email: string; name?: string }[];
  subject: string;
  category: string;
}

// ── SMS ─────────────────────────────────────────────────────────────

/** Parametros para enviar un SMS via Bird SMS API. */
export interface BirdSmsSendParams {
  to: string;
  from: string;
  text: string;
  category: "transactional" | "marketing" | "authentication" | "service";
  tags?: { name: string; value: string }[];
  metadata?: Record<string, unknown>;
}

/** Respuesta de Bird SMS (`202 Accepted`). */
export interface BirdSmsMessage {
  readonly id: string;
  readonly status: string;
  to: string;
  from: string;
  text?: string;
  category?: string;
}

// ── Verify (OTP) ────────────────────────────────────────────────────

/** Destinatario de una verificacion Bird: email o telefono (E.164). */
export type BirdVerifyRecipient<TRecipient = unknown> = TRecipient;

export interface BirdVerifyCreateParams {
  to: { email: string } | { phone_number: string };
  options?: { code_length?: number; channels?: string[] };
  metadata?: Record<string, unknown>;
}

export interface BirdVerifyCheckParams {
  to: { email: string } | { phone_number: string };
  code: string;
}

export type BirdVerificationStatus =
  | "pending"
  | "verified"
  | "failed"
  | "expired"
  | "canceled"
  | "blocked"
  | (string & {});

export interface BirdVerificationResponse {
  id: string;
  status: BirdVerificationStatus;
  reason?: string | null;
  expires_at: string;
  verified_at?: string | null;
}

export interface BirdVerificationCheckResult {
  success: boolean;
  reason?: string | null;
  attempts_remaining?: number | null;
  verification: BirdVerificationResponse;
}

@Injectable()
export class BirdService {
  private readonly logger = new Logger(BirdService.name);

  /** Promesa lazy del modulo ESM — se resuelve una sola vez. */
  private sdkPromise: Promise<BirdSdkModule> | null = null;

  /** Cliente Bird cacheado tras la primera carga del SDK. */
  private client: BirdClientInstance | null = null;

  /** API key leida de `BIRD_API_KEY`. */
  private readonly apiKey: string | undefined;

  /**
   * Valida que la API key tenga el formato correcto de Bird.
   * Las keys reales tienen prefijo `bk_us1_` o `bk_eu1_` (region-prefixed).
   * Un placeholder como `bk_xxxxxxxxx` o una key vacia NO pasa esta validacion.
   */
  private isValidKeyFormat(key: string): boolean {
    return /^bk_(us1|eu1)_\S+$/.test(key);
  }

  constructor() {
    const rawKey = process.env.BIRD_API_KEY;
    if (!rawKey) {
      this.logger.error(
        "BIRD_API_KEY no esta configurada — los servicios de Bird " +
          "(email, SMS, verify) NO funcionaran. Configura la env var " +
          "en Vercel con una key real (formato: bk_us1_... o bk_eu1_...).",
      );
      this.apiKey = undefined;
      return;
    }
    if (!this.isValidKeyFormat(rawKey)) {
      this.logger.error(
        `BIRD_API_KEY tiene formato invalido "${rawKey.slice(0, 7)}..." — ` +
          "debe empezar con bk_us1_ o bk_eu1_ seguido del secret. " +
          "Obten una key real desde Bird dashboard > Developers > API keys.",
      );
      this.apiKey = undefined;
      return;
    }
    this.apiKey = rawKey;
    const region = rawKey.startsWith("bk_us1_") ? "us1" : "eu1";
    this.logger.log(
      `Bird API configurada (region: ${region}) — email, SMS y verify activos.`,
    );
  }

  /** Indica si el cliente Bird esta configurado y listo para usarse. */
  isConfigured(): boolean {
    return (
      typeof this.apiKey === "string" && this.isValidKeyFormat(this.apiKey)
    );
  }

  /**
   * Carga perezosa el SDK ESM y construye el BirdClient.
   * Cachea ambos para que solo ocurra una vez por cold start.
   *
   * @returns el `BirdClient` cacheado.
   * @throws  si `BIRD_API_KEY` no esta configurada.
   */
  async getClient(): Promise<BirdClientInstance> {
    if (this.client) return this.client;
    if (!this.isConfigured() || !this.apiKey) {
      throw new Error(
        "Bird no esta configurado (falta BIRD_API_KEY o formato invalido)",
      );
    }
    this.sdkPromise ??= import("@messagebird/sdk");
    const sdk = await this.sdkPromise;
    this.client = new sdk.BirdClient({
      apiKey: this.apiKey,
    }) as BirdClientInstance;
    return this.client;
  }
}
