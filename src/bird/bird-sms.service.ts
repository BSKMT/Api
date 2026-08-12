import { Injectable, Logger } from "@nestjs/common";
import { BirdService } from "./bird.service";
import { notificationSmsTemplate } from "./email.templates";
import { maskPhone, sanitizeForLog } from "../common/utils/log-redact.util";

/**
 * BirdSmsService — Servicio para el envio de mensajes SMS a traves de
 * Bird SMS API (`POST /v1/sms/messages` via `bird.sms.send()`).
 *
 * Seguridad (OWASP A04, A05, A07):
 *  - `category: "transactional"` para notificaciones del sistema.
 *  - El remitente (`from`) se configura via `BIRD_SMS_SENDER` (env).
 *    Alphanumeric sender IDs (1-11 chars, min 1 letra) o numero E.164.
 *  - Validacion estricta de formato E.164 para `to` antes de enviar.
 *  - El SDK inyecta `Idempotency-Key` automaticamente.
 *  - Logs enmascaran el numero del destinatario (maskPhone).
 *  - Si Bird no esta configurado, opera en modo degradado (no-op).
 */
@Injectable()
export class BirdSmsService {
  private readonly logger = new Logger(BirdSmsService.name);

  /** Sender ID alfanumerico o numero E.164 (env BIRD_SMS_SENDER). */
  private readonly sender: string;

  /** Patron E.164: + seguido de 6-15 digitos. */
  private static readonly E164_PATTERN = /^\+[1-9]\d{5,14}$/;

  constructor(private readonly birdService: BirdService) {
    this.sender = process.env.BIRD_SMS_SENDER ?? "BSKMT";
  }

  /** Valida que un numero este en formato E.164. */
  isValidE164(phone: string): boolean {
    return BirdSmsService.E164_PATTERN.test(phone);
  }

  /**
   * Envia un SMS transaccional de notificacion del sistema.
   *
   * @param to    Numero E.164 del destinatario (ej: +573001234567).
   * @param title  Titulo corto de la notificacion.
   * @param message  Cuerpo del mensaje.
   * @returns `true` si Bird acepto el mensaje (202), `false` si fallo
   *          o Bird no esta configurado.
   */
  async sendNotificationSms(data: {
    to: string;
    title: string;
    message: string;
  }): Promise<boolean> {
    if (!this.birdService.isConfigured()) return false;

    if (!this.isValidE164(data.to)) {
      this.logger.warn(`Numero SMS invalido (no E.164): ${maskPhone(data.to)}`);
      return false;
    }

    const text = notificationSmsTemplate({
      title: data.title,
      message: data.message,
    });

    try {
      const client = await this.birdService.getClient();
      await client.sms.send({
        to: data.to,
        from: this.sender,
        text,
        category: "transactional",
      });
      this.logger.log(
        `SMS enviado a ${maskPhone(data.to)}: ${sanitizeForLog(text.slice(0, 40))}...`,
      );
      return true;
    } catch (err: unknown) {
      this.logger.error(
        `Error enviando SMS a ${maskPhone(data.to)}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }
}
