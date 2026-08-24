import { Injectable, Logger } from "@nestjs/common";
import { BirdService } from "./bird.service";
import { notificationWhatsappTemplate } from "./whatsapp.templates";
import { maskPhone, sanitizeForLog } from "../common/utils/log-redact.util";

/**
 * BirdWhatsappService — Servicio para el envio de mensajes WhatsApp a
 * traves de Bird WhatsApp API (`POST /v1/whatsapp/messages` via
 * `bird.whatsapp.send()`).
 *
 * Envia notificaciones transaccionales del sistema como texto libre
 * (free-form text), lo que requiere:
 *  - Un numero remitente E.164 (`BIRD_WHATSAPP_SENDER`) que el
 *    workspace posea y tenga conectado a un WhatsApp Business Account.
 *  - Una ventana de servicio al cliente abierta (24h desde el ultimo
 *    mensaje entrante del destinatario). Si la ventana esta cerrada,
 *    Bird acepta el mensaje (202) pero falla asincronamente con
 *    `service_window_expired`. Este caso se maneja como best-effort:
 *    se registra el fallo pero no se lanza ni se bloquea el flujo.
 *
 * Seguridad (OWASP A04, A05, A07, A09, A10):
 *  - Validacion estricta de formato E.164 para `to` y `from` antes
 *    de cualquier llamada a la API (A05 — Injection prevention).
 *  - El cuerpo del mensaje se sanitiza en la plantilla (sin CRLF,
 *    sin caracteres de control, max 4096 chars, preview_url=false).
 *  - `preview_url: false` para evitar que WhatsApp genere previews
 *    de URLs que podrian ser usadas para phishing (A05 — defense in
 *    depth).
 *  - El SDK inyecta `Idempotency-Key` automaticamente (reintentos
 *    seguros, sin duplicados).
 *  - Logs enmascaran el numero del destinatario (maskPhone) y
 *    sanitizan el contenido del mensaje (sanitizeForLog) (A09 — no
 *    PII en logs, CWE-532, CWE-117).
 *  - Si Bird no esta configurado o el sender no es E.164 valido,
 *    opera en modo degradado (no-op + log) sin lanzar errores
 *    (A10 — graceful degradation).
 *  - El envio es best-effort: un fallo no bloquea otros canales ni
 *    el flujo principal del negocio (A10 — mishandling of exceptional
 *    conditions).
 */
@Injectable()
export class BirdWhatsappService {
  private readonly logger = new Logger(BirdWhatsappService.name);

  /**
   * Numero remitente E.164 (env `BIRD_WHATSAPP_SENDER`).
   * Debe ser un numero que el workspace posea y tenga conectado a
   * un WhatsApp Business Account en Bird.
   */
  private readonly sender: string;

  /** Patron E.164: + seguido de 6-15 digitos. */
  private static readonly E164_PATTERN = /^\+[1-9]\d{5,14}$/;

  constructor(private readonly birdService: BirdService) {
    this.sender = process.env.BIRD_WHATSAPP_SENDER ?? "";
  }

  /** Valida que un numero este en formato E.164. */
  isValidE164(phone: string): boolean {
    return BirdWhatsappService.E164_PATTERN.test(phone);
  }

  /** Indica si el sender de WhatsApp esta configurado y es E.164 valido. */
  isSenderConfigured(): boolean {
    return Boolean(this.sender) && this.isValidE164(this.sender);
  }

  /**
   * Envia un mensaje WhatsApp transaccional de notificacion del
   * sistema como texto libre (free-form text).
   *
   * Requisitos:
   *  - Bird debe estar configurado (`BIRD_API_KEY` valida).
   *  - El remitente (`BIRD_WHATSAPP_SENDER`) debe ser E.164 valido.
   *  - El destinatario (`to`) debe ser E.164 valido.
   *  - Debe existir una ventana de servicio al cliente abierta (24h).
   *    Si no, Bird acepta (202) pero falla asincronamente; el fallo
   *    se detecta leyendo el mensaje posteriormente, no en el envio.
   *
   * @param data.to      Numero E.164 del destinatario (ej: +573001234567).
   * @param data.title    Titulo corto de la notificacion.
   * @param data.message  Cuerpo del mensaje.
   * @returns `true` si Bird acepto el mensaje (202), `false` si fallo
   *          la validacion, Bird no esta configurado, o el sender no
   *          es E.164 valido.
   */
  async sendNotificationWhatsapp(data: {
    to: string;
    title: string;
    message: string;
  }): Promise<boolean> {
    if (!this.birdService.isConfigured()) return false;

    if (!this.isSenderConfigured()) {
      this.logger.warn(
        "BIRD_WHATSAPP_SENDER no configurado o formato E.164 invalido " +
          "(debe ser +<country><number>, ej: +13124495648). " +
          "WhatsApp omitido.",
      );
      return false;
    }

    if (!this.isValidE164(data.to)) {
      this.logger.warn(
        `Numero WhatsApp invalido (no E.164): ${maskPhone(data.to)}`,
      );
      return false;
    }

    const body = notificationWhatsappTemplate({
      title: data.title,
      message: data.message,
    });

    try {
      const client = await this.birdService.getClient();
      await client.whatsapp.send({
        to: data.to,
        from: this.sender,
        text: {
          body,
          preview_url: false,
        },
        tags: [{ name: "channel", value: "notification" }],
      });
      this.logger.log(
        `WhatsApp enviado a ${maskPhone(data.to)}: ${sanitizeForLog(body.slice(0, 40))}...`,
      );
      return true;
    } catch (err: unknown) {
      this.logger.error(
        `Error enviando WhatsApp a ${maskPhone(data.to)}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }
}
