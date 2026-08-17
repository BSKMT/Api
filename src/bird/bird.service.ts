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
 *  - `realtime.publish()`          — publica un evento a uno o mas canales
 *  - `realtime.publishBatch()`     — publica hasta 10 eventos en una solicitud
 *  - `realtime.members.send()`     — envia un evento directo a un miembro
 *  - `realtime.members.disconnect()` — cierra todas las conexiones de un miembro
 *  - `realtime.channels.list()`   — consulta cuales canales estan ocupados
 *  - `webhooks.unwrap()`           — verifica y decodifica webhooks de Bird
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
  readonly realtime: {
    publish: (
      appId: string,
      params: BirdRealtimePublishParams,
    ) => Promise<BirdRealtimePublishResult>;
    publishBatch: (
      appId: string,
      params: BirdRealtimeBatchParams,
    ) => Promise<BirdRealtimeBatchResult>;
    readonly members: {
      send: (
        appId: string,
        memberId: string,
        params: BirdRealtimeMemberEventParams,
      ) => Promise<void>;
      disconnect: (appId: string, memberId: string) => Promise<void>;
    };
    readonly channels: {
      list: (
        appId: string,
        opts?: { prefix?: string },
      ) => Promise<{ data: BirdRealtimeChannelInfo[] }>;
    };
  };
  readonly webhooks: {
    unwrap: (
      body: Buffer | string,
      headers: Record<string, string | string[] | undefined>,
    ) => BirdWebhookEvent;
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

// ── Realtime ──────────────────────────────────────────────────────────

/** Parametros para publicar un evento a uno o mas canales. */
export interface BirdRealtimePublishParams {
  event: string;
  channels: string[];
  data: unknown;
  /** Excluye una conexion de recibir el evento (opcional). */
  exclude_connection_id?: string;
  /** Solicita metadata de los canales tras el publish (opcional). */
  include?: string[];
}

/** Resultado de un publish. */
export interface BirdRealtimePublishResult {
  id?: string;
  channels?: Record<string, unknown>;
}

/** Parametros para publicar un batch de hasta 10 eventos. */
export interface BirdRealtimeBatchParams {
  events: {
    event: string;
    channels: string[];
    data: unknown;
    exclude_connection_id?: string;
  }[];
}

/** Resultado de un batch publish. */
export interface BirdRealtimeBatchResult {
  id?: string;
}

/** Parametros para enviar un evento directo a un miembro. */
export interface BirdRealtimeMemberEventParams {
  event: string;
  data: unknown;
}

/** Informacion de un canal en la lista de canales ocupados. */
export interface BirdRealtimeChannelInfo {
  name: string;
  occupied: boolean;
  member_count?: number;
  connection_count?: number;
}

// ── Webhooks ──────────────────────────────────────────────────────────

/** Evento webhook desenvelopado por `bird.webhooks.unwrap()`. */
export interface BirdWebhookEvent {
  id: string;
  type: string;
  timestamp: string;
  data: Record<string, unknown>;
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

  /** Realtime config — populated when all four envs are present. */
  private readonly realtimeConfig: {
    appId: string;
    key: string;
    secret: string;
  } | null = null;

  /** Webhook signing secret (optional, for `bird.webhooks.unwrap`). */
  private readonly webhookSecret: string | undefined;

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

    // Realtime — los cuatro valores deben estar presentes; si falta alguno,
    // realtimeService.isRealtimeConfigured() devuelve false y todo degrada.
    const rtAppId = process.env.BIRD_REALTIME_APP_ID ?? "";
    const rtKey = process.env.BIRD_REALTIME_KEY ?? "";
    const rtSecret = process.env.BIRD_REALTIME_SECRET ?? "";
    if (rtAppId && rtKey && rtSecret) {
      this.realtimeConfig = { appId: rtAppId, key: rtKey, secret: rtSecret };
      this.logger.log(
        `Bird Realtime configurado (appId: ${rtAppId.slice(0, 8)}...) — publish y member events activos.`,
      );
    } else {
      this.realtimeConfig = null;
      this.logger.warn(
        "Bird Realtime NO configurado — falta alguno de BIRD_REALTIME_APP_ID, BIRD_REALTIME_KEY o BIRD_REALTIME_SECRET. " +
          "Las notificaciones realtime NO funcionaran, pero el polling de respaldo sigue activo.",
      );
    }

    // Webhook secret (for bird.webhooks.unwrap). Optional but strongly
    // recommended for verifying realtime.* webhook deliveries.
    const webhookSecret = process.env.BIRD_WEBHOOK_SECRET;
    if (webhookSecret) {
      this.webhookSecret = webhookSecret;
      this.logger.log(
        "Bird Webhook secret configurado — verificacion de webhooks activa.",
      );
    }
  }

  /** Indica si el cliente Bird esta configurado y listo para usarse. */
  isConfigured(): boolean {
    return (
      typeof this.apiKey === "string" && this.isValidKeyFormat(this.apiKey)
    );
  }

  /** Indica si Bird Realtime está configurado (appId + key + secret presentes). */
  isRealtimeConfigured(): boolean {
    return this.realtimeConfig !== null;
  }

  /** Devuelve el appId de Realtime o null si no está configurado. */
  getRealtimeAppId(): string | null {
    return this.realtimeConfig?.appId ?? null;
  }

  /** Devuelve la key pública de Realtime o null. */
  getRealtimeKey(): string | null {
    return this.realtimeConfig?.key ?? null;
  }

  /** Devuelve el secret de Realtime o null. */
  getRealtimeSecret(): string | null {
    return this.realtimeConfig?.secret ?? null;
  }

  /** Devuelve el webhook secret o undefined. */
  getWebhookSecret(): string | undefined {
    return this.webhookSecret;
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

    // Build constructor options — always include apiKey, conditionally
    // include realtime { key, secret } and webhooks { secret } blocks.
    // The SDK enables the `bird.realtime.*` and `bird.webhooks.*`
    // namespaces only when these blocks are present.
    const clientOpts: Record<string, unknown> = {
      apiKey: this.apiKey,
    };
    if (this.realtimeConfig) {
      clientOpts["realtime"] = {
        key: this.realtimeConfig.key,
        secret: this.realtimeConfig.secret,
      };
    }
    if (this.webhookSecret) {
      clientOpts["webhooks"] = { secret: this.webhookSecret };
    }

    this.client = new sdk.BirdClient(
      clientOpts as { apiKey: string },
    ) as BirdClientInstance;
    return this.client;
  }
}
