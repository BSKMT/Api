import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { BirdEmailService } from "../bird/bird-email.service";
import { ContactDto } from "./dto/contact.dto";
import { maskEmail, sanitizeForLog } from "../common/utils/log-redact.util";

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

  private async verifyCaptchaIfConfigured(
    token: string | undefined,
    ip?: string,
  ): Promise<void> {
    const secret = process.env.TURNSTILE_SECRET_KEY;
    if (!secret) return;
    if (!token) {
      throw new BadRequestException(
        "Falta el token de verificación humana. Recarga la página e intenta de nuevo.",
      );
    }
    try {
      const body = new URLSearchParams({
        secret,
        response: token,
      });
      if (ip) body.set("remoteip", ip);
      const res = await fetch(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
      };
      if (!data.success) {
        this.logger.warn(
          "Turnstile siteverify failed — challenge rejected the token",
        );
        throw new BadRequestException(
          "No pudimos verificar que eres humano. Intenta de nuevo.",
        );
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.warn(
        `Turnstile siteverify network error: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new BadRequestException(
        "No se pudo verificar la prueba humana. Intenta más tarde.",
      );
    }
  }

  async handleContact(dto: ContactDto): Promise<{
    message: string;
    delivered: boolean;
  }> {
    await this.verifyCaptchaIfConfigured(dto.captchaToken);

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
