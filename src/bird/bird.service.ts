import { Injectable, Logger } from "@nestjs/common";
import type {
  BirdSdkModule,
  BirdClientInstance,
} from "./bird-realtime.interfaces";

export type {
  BirdEmailSendParams,
  BirdEmailMessage,
  BirdSmsSendParams,
  BirdSmsMessage,
  BirdWhatsappTextContent,
  BirdWhatsappSendParams,
  BirdWhatsappMessage,
  BirdVerifyRecipient,
  BirdVerifyCreateParams,
  BirdVerifyCheckParams,
  BirdVerificationStatus,
  BirdVerificationResponse,
  BirdVerificationCheckResult,
} from "./bird-communication.interfaces";

export type {
  BirdSdkModule,
  BirdClientInstance,
  BirdRealtimePublishParams,
  BirdRealtimePublishResult,
  BirdRealtimeBatchParams,
  BirdRealtimeBatchResult,
  BirdRealtimeMemberEventParams,
  BirdRealtimeChannelInfo,
  BirdWebhookEvent,
} from "./bird-realtime.interfaces";

@Injectable()
export class BirdService {
  private readonly logger = new Logger(BirdService.name);

  private sdkPromise: Promise<BirdSdkModule> | null = null;
  private client: BirdClientInstance | null = null;
  private readonly apiKey: string | undefined;

  private readonly realtimeConfig: {
    appId: string;
    key: string;
    secret: string;
  } | null = null;

  private readonly webhookSecret: string | undefined;

  private isValidKeyFormat(key: string): boolean {
    return /^bk_(us1|eu1)_\S+$/.test(key);
  }

  constructor() {
    const rawKey = process.env.BIRD_API_KEY;
    if (!rawKey) {
      this.logger.error(
        "BIRD_API_KEY no esta configurada — los servicios de Bird " +
          "(email, SMS, WhatsApp, verify) NO funcionaran.",
      );
      this.apiKey = undefined;
      return;
    }
    if (!this.isValidKeyFormat(rawKey)) {
      this.logger.error(
        `BIRD_API_KEY tiene formato invalido "${rawKey.slice(0, 7)}..." — ` +
          "debe empezar con bk_us1_ o bk_eu1_ seguido del secret.",
      );
      this.apiKey = undefined;
      return;
    }
    this.apiKey = rawKey;
    const region = rawKey.startsWith("bk_us1_") ? "us1" : "eu1";
    this.logger.log(
      `Bird API configurada (region: ${region}) — email, SMS, WhatsApp y verify activos.`,
    );

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
        "Bird Realtime NO configurado — notificaciones realtime desactivadas.",
      );
    }

    const webhookSecret = process.env.BIRD_WEBHOOK_SECRET;
    if (webhookSecret) {
      this.webhookSecret = webhookSecret;
      this.logger.log(
        "Bird Webhook secret configurado — verificacion de webhooks activa.",
      );
    }
  }

  isConfigured(): boolean {
    return (
      typeof this.apiKey === "string" && this.isValidKeyFormat(this.apiKey)
    );
  }

  isRealtimeConfigured(): boolean {
    return this.realtimeConfig !== null;
  }

  getRealtimeAppId(): string | null {
    return this.realtimeConfig?.appId ?? null;
  }

  getRealtimeKey(): string | null {
    return this.realtimeConfig?.key ?? null;
  }

  getRealtimeSecret(): string | null {
    return this.realtimeConfig?.secret ?? null;
  }

  getWebhookSecret(): string | undefined {
    return this.webhookSecret;
  }

  async getClient(): Promise<BirdClientInstance> {
    if (this.client) return this.client;
    if (!this.isConfigured() || !this.apiKey) {
      throw new Error(
        "Bird no esta configurado (falta BIRD_API_KEY o formato invalido)",
      );
    }
    this.sdkPromise ??=
      import("@messagebird/sdk") as unknown as Promise<BirdSdkModule>;
    const sdk = await this.sdkPromise;

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
