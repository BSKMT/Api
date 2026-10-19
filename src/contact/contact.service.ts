import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { BirdEmailService } from "../bird/bird-email.service";
import { ContactDto } from "./dto/contact.dto";
import { maskEmail, sanitizeForLog } from "../common/utils/log-redact.util";
import { verifyTurnstileToken } from "../common/utils/turnstile.util";

/**
 * ContactService - Orquesta el envio de correos para el formulario de
 * contacto publico de la landing page.
 *
 * Envia un correo interno con los datos del contacto al equipo BSK.
 * No envia auto-respuesta al remitente (A7: elimina relay de spam/phishing).
 */
@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);

  constructor(private readonly emailService: BirdEmailService) {}

  async handleContact(
    dto: ContactDto,
    clientIp?: string,
  ): Promise<{
    message: string;
    delivered: boolean;
  }> {
    await verifyTurnstileToken(dto.captchaToken, clientIp, this.logger);

    const { delivered } = await this.emailService.sendContactMessages({
      name: dto.name,
      email: dto.email,
      subject: dto.subject,
      message: dto.message,
      source: "Formulario de contacto web",
    });

    if (!delivered) {
      this.logger.warn(
        `Contacto de ${maskEmail(dto.email)} registrado pero no entregado por correo`,
      );
      throw new BadRequestException({
        message:
          "No fue posible enviar tu mensaje en este momento. Intenta nuevamente mas tarde.",
      });
    }

    this.logger.log(
      `Mensaje de contacto recibido de ${maskEmail(dto.email)} asunto: ${sanitizeForLog(dto.subject)}`,
    );
    return {
      message:
        "Hemos recibido tu mensaje. Te contactaremos en un maximo de 48 horas habiles.",
      delivered: true,
    };
  }
}
