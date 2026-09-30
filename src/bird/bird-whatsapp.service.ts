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
  private readonly defaultTemplateSlug: string;

  /** Patron E.164: + seguido de 6-15 digitos. */
  private static readonly E164_PATTERN = /^\+[1-9]\d{5,14}$/;

  constructor(private readonly birdService: BirdService) {
    this.sender = process.env.BIRD_WHATSAPP_SENDER ?? "";
    this.defaultTemplateSlug = process.env.BIRD_WHATSAPP_TEMPLATE_SLUG ?? "";
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
   * sistema como plantilla aprobada (proactiva) o texto libre
   * (dentro de ventana de 24h).
   *
   * Requisitos:
   *  - Bird debe estar configurado (`BIRD_API_KEY` valida).
   *  - El destinatario (`to`) debe ser E.164 valido.
   *  - Si se envia como plantilla (`templateSlug` o env `BIRD_WHATSAPP_TEMPLATE_SLUG`):
   *    Puede entregarse en cualquier momento (incluso fuera de 24h).
   *  - Si se envia como texto libre:
   *    Requiere `BIRD_WHATSAPP_SENDER` configurado y ventana de 24h abierta.
   *
   * @param data.to            Numero E.164 del destinatario (ej: +573001234567).
   * @param data.title          Titulo corto de la notificacion.
   * @param data.message        Cuerpo del mensaje.
   * @param data.templateSlug   Slug opcional de plantilla de WhatsApp aprobada.
   * @param data.language       Idioma de la plantilla (default "es").
   * @returns `true` si Bird acepto el mensaje (202), `false` si fallo.
   */
  async sendNotificationWhatsapp(data: {
    to: string;
    title: string;
    message: string;
    templateSlug?: string;
    language?: string;
  }): Promise<boolean> {
    if (!this.birdService.isConfigured()) return false;

    if (!this.isValidE164(data.to)) {
      this.logger.warn(
        `Numero WhatsApp invalido (no E.164): ${maskPhone(data.to)}`,
      );
      return false;
    }

    const templateSlug = data.templateSlug || this.defaultTemplateSlug;

    try {
      const client = await this.birdService.getClient();

      if (templateSlug) {
        // Envio con plantilla aprobada (entrega garantizada fuera de ventana de 24h)
        const sendParams: Record<string, unknown> = {
          to: data.to,
          template: {
            slug: templateSlug,
            language: data.language ?? "es",
            components: [
              {
                type: "body",
                parameters: [
                  { type: "text", text: data.title },
                  { type: "text", text: data.message },
                ],
              },
            ],
          },
          tags: [{ name: "channel", value: "notification" }],
        };
        // Para plantillas administradas por Bird (bird_*), no enviar 'from'.
        // Para plantillas propias del workspace, enviar 'from' si esta configurado.
        if (this.isSenderConfigured() && !templateSlug.startsWith("bird_")) {
          sendParams["from"] = this.sender;
        }

        await client.whatsapp.send(sendParams as never);
        this.logger.log(
          `WhatsApp (plantilla "${templateSlug}") enviado a ${maskPhone(data.to)}`,
        );
        return true;
      }

      // Envio como texto libre (requiere remitente y ventana de 24h abierta)
      if (!this.isSenderConfigured()) {
        this.logger.warn(
          "BIRD_WHATSAPP_SENDER no configurado o formato E.164 invalido " +
            "(debe ser +<country><number>, ej: +13124495648). " +
            "WhatsApp omitido.",
        );
        return false;
      }

      const body = notificationWhatsappTemplate({
        title: data.title,
        message: data.message,
      });

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
      const errMsg = err instanceof Error ? err.message : String(err);
      if (
        errMsg.includes("WhatsAppServiceWindowClosed") ||
        errMsg.includes("422")
      ) {
        this.logger.warn(
          `WhatsApp a ${maskPhone(data.to)} no entregado: ventana de 24 horas del usuario cerrada. ` +
            "Para notificaciones proactivas fuera de la ventana de 24h, configure una plantilla aprobada (BIRD_WHATSAPP_TEMPLATE_SLUG).",
        );
      } else {
        this.logger.error(
          `Error enviando WhatsApp a ${maskPhone(data.to)}: ${errMsg}`,
        );
      }
      return false;
    }
  }
}
