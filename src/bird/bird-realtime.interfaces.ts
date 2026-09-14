import type {
  BirdEmailSendParams,
  BirdEmailMessage,
  BirdSmsSendParams,
  BirdSmsMessage,
  BirdWhatsappSendParams,
  BirdWhatsappMessage,
  BirdVerifyCreateParams,
  BirdVerifyCheckParams,
  BirdVerificationResponse,
  BirdVerificationCheckResult,
} from "./bird-communication.interfaces";

/** Tipo del modulo ESM `@messagebird/sdk` tras el dynamic import. */
export interface BirdSdkModule {
  BirdClient: new (opts: { apiKey: string }) => unknown;
}

/** Parametros para publicar un evento a uno o mas canales. */
export interface BirdRealtimePublishParams {
  event: string;
  channels: string[];
  data: unknown;
  exclude_connection_id?: string;
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

/** Evento webhook desenvelopado por `bird.webhooks.unwrap()`. */
export interface BirdWebhookEvent {
  id: string;
  type: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface BirdClientInstance {
  readonly email: {
    send: (params: BirdEmailSendParams) => Promise<BirdEmailMessage>;
  };
  readonly sms: {
    send: (params: BirdSmsSendParams) => Promise<BirdSmsMessage>;
  };
  readonly whatsapp: {
    send: (params: BirdWhatsappSendParams) => Promise<BirdWhatsappMessage>;
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
