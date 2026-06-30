import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { EnvironmentConfig } from "../config/config.interface";
import type {
  ZohoMailResult,
  ZohoSendEmailParams,
  ZohoSendEmailResponse,
  ZohoTokenResponse,
} from "./zoho-mail.interfaces";

/**
 * ZohoMailService - Servicio de bajo nivel para la integracion con la API
 * de Zoho Mail.
 *
 * Responsabilidades:
 *  1. Gestion del ciclo de vida del token de acceso OAuth 2.0 de Zoho,
 *     refrescandolo automaticamente cuando expira (validez ~1 hora).
 *  2. Envio de correos a traves del endpoint REST de Zoho Mail.
 *
 * Toda la configuracion proviene de variables de entorno (ConfigService).
 * Si las credenciales de Zoho no estan configuradas, el servicio opera en
 * modo degradado: no envia correos y registra advertencias, evitando que la
 * aplicacion falle por completo.
 */
@Injectable()
export class ZohoMailService {
  private readonly logger = new Logger(ZohoMailService.name);

  /** Token de acceso en memoria y fecha de expiracion absoluta. */
  private accessToken: string | null = null;
  private expiresAt = 0;
  /** Mutex para evitar refrescos concurrentes del token. */
  private refreshPromise: Promise<string> | null = null;

  constructor(
    private readonly configService: ConfigService<EnvironmentConfig, true>,
  ) {}

  /**
   * Indica si la integracion con Zoho Mail esta configurada correctamente.
   * Se requiere client id, client secret, refresh token y account id.
   */
  isConfigured(): boolean {
    return Boolean(
      this.configService.get("ZOHO_CLIENT_ID", { infer: true }) &&
      this.configService.get("ZOHO_CLIENT_SECRET", { infer: true }) &&
      this.configService.get("ZOHO_REFRESH_TOKEN", { infer: true }) &&
      this.configService.get("ZOHO_ACCOUNT_ID", { infer: true }),
    );
  }

  /**
   * Obtiene un token de acceso valido, refrescandolo si hace falta.
   * Devuelve un token valido o lanza un Error si Zoho no esta configurado.
   */
  async getAccessToken(): Promise<string> {
    if (!this.isConfigured()) {
      throw new Error("Zoho Mail no esta configurado");
    }

    const now = Date.now();
    // Margen de seguridad de 60s antes de la expiracion real.
    if (this.accessToken && now < this.expiresAt - 60_000) {
      return this.accessToken;
    }

    // Evita multiples refrescos simultaneos reutilizando la promesa en curso.
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.refreshAccessToken()
      .then((token) => {
        this.accessToken = token;
        return token;
      })
      .finally(() => {
        this.refreshPromise = null;
      });

    return this.refreshPromise;
  }

  /**
   * Renueva el token de acceso usando el refresh token almacenado.
   * Endpoint: POST {ZOHO_TOKEN_BASE}/token
   */
  private async refreshAccessToken(): Promise<string> {
    const tokenBase = this.configService.get("ZOHO_TOKEN_BASE", {
      infer: true,
    });
    const clientId = this.configService.get("ZOHO_CLIENT_ID", { infer: true });
    const clientSecret = this.configService.get("ZOHO_CLIENT_SECRET", {
      infer: true,
    });
    const refreshToken = this.configService.get("ZOHO_REFRESH_TOKEN", {
      infer: true,
    });

    const url = new URL(`${tokenBase}/token`);
    url.searchParams.set("refresh_token", refreshToken);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("client_secret", clientSecret);
    url.searchParams.set("grant_type", "refresh_token");

    const res = await fetch(url, { method: "POST" });
    const data = (await res.json()) as ZohoTokenResponse & {
      error?: string;
    };

    if (!res.ok || !data.access_token) {
      const detail = data.error ?? res.statusText;
      this.logger.error(
        `Fallo al refrescar el token de Zoho: ${res.status} ${detail}`,
      );
      throw new Error(`No se pudo refrescar el token de Zoho: ${detail}`);
    }

    this.expiresAt = Date.now() + (data.expires_in ?? 3600) * 1000;
    this.logger.debug("Token de Zoho refrescado correctamente");
    return data.access_token;
  }

  /**
   * Envia un correo a traves de la API REST de Zoho Mail.
   *
   * Endpoint: POST {ZOHO_API_BASE}/api/accounts/{accountId}/messages
   * Cabecera Authorization: Zoho-oauthtoken {access_token}
   *
   * @returns resultado normalizado con el estado del envio.
   */
  async sendEmail(params: ZohoSendEmailParams): Promise<ZohoMailResult> {
    const isConfigured = this.isConfigured();
    if (!isConfigured) {
      this.logger.warn(
        "Zoho Mail no esta configurado: se omite el envio del correo",
      );
      return {
        ok: false,
        code: 0,
        message: "Zoho Mail no configurado",
      };
    }

    try {
      const apiBase = this.configService.get("ZOHO_API_BASE", {
        infer: true,
      });
      const accountId = this.configService.get("ZOHO_ACCOUNT_ID", {
        infer: true,
      });
      const accessToken = await this.getAccessToken();

      const url = `${apiBase}/api/accounts/${accountId}/messages`;
      const body: ZohoSendEmailParams = {
        fromAddress: params.fromAddress,
        toAddress: params.toAddress,
        subject: params.subject,
        content: params.content,
        mailFormat: params.mailFormat ?? "html",
      };
      if (params.ccAddress) body.ccAddress = params.ccAddress;
      if (params.bccAddress) body.bccAddress = params.bccAddress;
      if (params.askReceipt) body.askReceipt = params.askReceipt;
      if (params.encoding) body.encoding = params.encoding;

      const res = await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Zoho-oauthtoken ${accessToken}`,
        },
        body: JSON.stringify(body),
      });

      const data = (await res.json()) as ZohoSendEmailResponse & {
        error?: string;
      };

      const code = data.status?.code ?? res.status;
      const ok = res.ok && code >= 200 && code < 300;

      if (!ok) {
        const detail =
          data.data?.moreInfo ?? data.status?.description ?? res.statusText;
        this.logger.error(`Envio de correo fallido (Zoho ${code}): ${detail}`);
        return {
          ok: false,
          code,
          message: String(detail),
        };
      }

      this.logger.log(
        `Correo enviado a ${params.toAddress} asunto "${params.subject}"`,
      );
      return {
        ok: true,
        code,
        message: "Correo enviado",
        messageId: data.data?.messageId,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Error enviando correo por Zoho: ${message}`);
      return { ok: false, code: 0, message };
    }
  }
}
