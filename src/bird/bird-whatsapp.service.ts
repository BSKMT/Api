import { Injectable, Logger } from "@nestjs/common";
import { BirdService } from "./bird.service";
import { notificationWhatsappTemplate } from "./whatsapp.templates";
import { maskPhone, sanitizeForLog } from "../common/utils/log-redact.util";

/**
 * BirdWhatsappService — Envio de mensajes WhatsApp vía Bird API.
 * Soporta notificaciones transaccionales (plantillas y texto libre) y chat directo en vivo.
 * Cumple con validación E.164, sanitización anti-phishing, idempotencia y degradación elegante.
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
    this.sender = process.env.BIRD_WHATSAPP_SENDER || "+573169588444";
    this.defaultTemplateSlug = process.env.BIRD_WHATSAPP_TEMPLATE_SLUG ?? "";
  }

  /** Patron BSUID (Business-Scoped User ID de Meta / WhatsApp) o ID de grupo/contacto Bird */
  private static readonly BSUID_PATTERN =
    /^[A-Z]{2}\.\d+$|^wag_[a-zA-Z0-9]+$|^[a-zA-Z0-9_.-]{4,80}$/;

  /** Valida que un destinatario sea un teléfono E.164 o BSUID de Meta/WhatsApp. */
  isValidRecipient(recipient: string): boolean {
    if (!recipient || typeof recipient !== "string") return false;
    const trimmed = recipient.trim();
    return (
      BirdWhatsappService.E164_PATTERN.test(trimmed) ||
      BirdWhatsappService.BSUID_PATTERN.test(trimmed)
    );
  }

  /** Valida que un numero este en formato E.164. */
  isValidE164(phone: string): boolean {
    return (
      Boolean(phone) && BirdWhatsappService.E164_PATTERN.test(phone.trim())
    );
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

    if (!this.isValidRecipient(data.to)) {
      this.logger.warn(
        `Destinatario WhatsApp invalido (no es E.164 ni BSUID): ${maskPhone(data.to)}`,
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

  /**
   * Envia un mensaje directo de WhatsApp (conversacional / bot / chat en vivo)
   * con formato libre (saltos de linea, emojis, listas), sin envolverlo en
   * plantillas fijas.
   *
   * Requiere ventana de 24h activa y sender configurado.
   */
  async sendDirectWhatsapp(data: {
    to: string;
    text: string;
  }): Promise<boolean> {
    if (!this.birdService.isConfigured()) return false;

    if (!this.isValidRecipient(data.to)) {
      this.logger.warn(
        `Destinatario WhatsApp invalido (no es E.164 ni BSUID): ${maskPhone(data.to)}`,
      );
      return false;
    }

    if (!this.isSenderConfigured()) {
      this.logger.warn(
        "BIRD_WHATSAPP_SENDER no configurado o formato invalido para chat en vivo.",
      );
      return false;
    }

    try {
      const client = await this.birdService.getClient();

      // Normalizar saltos de linea y remover caracteres de control
      const sanitized = data.text
        .replaceAll("\r\n", "\n")
        .replace(/[\r\t\v\f\0]/g, " ")
        .trim();
      const body =
        sanitized.length > 4096 ? sanitized.slice(0, 4093) + "..." : sanitized;

      await client.whatsapp.send({
        to: data.to,
        from: this.sender,
        text: {
          body,
          preview_url: false,
        },
        tags: [{ name: "channel", value: "live_chat" }],
      });

      this.logger.log(
        `WhatsApp directo enviado a ${maskPhone(data.to)} (${body.length} caracteres)`,
      );
      return true;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Error enviando WhatsApp directo a ${maskPhone(data.to)}: ${errMsg}`,
      );
      return false;
    }
  }
}
