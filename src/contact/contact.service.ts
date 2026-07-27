import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { EmailService } from "../zoho-mail/email.service";
import { ContactDto } from "./dto/contact.dto";
import { maskEmail, sanitizeForLog } from "../common/utils/log-redact.util";

/**
 * ContactService - Orquesta el envio de correos para el formulario de
 * contacto publico de la landing page.
 *
 * Envia un correo interno con los datos del contacto al equipo BSK.
 * No envia auto-respuesta al remitente (A7: elimina relay de spam/phishing).
 *
 * Si Zoho Mail no esta configurado, el metodo lanza un BadRequestException
 * para que el frontend informe al usuario de forma clara, evitando prometer
 * una entrega que no ocurrira.
 */
@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);

  constructor(private readonly emailService: EmailService) {}

  /**
   * M-8: optional Cloudflare Turnstile verification. When the
   * `TURNSTILE_SECRET_KEY` env var is set, the request MUST include a
   * valid `captchaToken` (validated server-side via Cloudflare's
   * `siteverify` endpoint). When the env var is not set the check is
   * skipped (transition period — flip the env switch only after the
   * frontend Astro ships the Turnstile widget).
   */
  private async verifyCaptchaIfConfigured(
    token: string | undefined,
    ip?: string,
  ): Promise<void> {
    const secret = process.env.TURNSTILE_SECRET_KEY;
    if (!secret) return; // turnstile not configured yet
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
      // Fail-closed — refuse the submission if we can't verify the challenge.
      throw new BadRequestException(
        "No se pudo verificar la prueba humana. Intenta más tarde.",
      );
    }
  }

  async handleContact(dto: ContactDto): Promise<{
    message: string;
    delivered: boolean;
  }> {
    // M-8: gates the public relay behind a CAPTCHA when configured.
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
        `Contacto de ${maskEmail(dto.email)} registrado pero no entregado por correo (Zoho no configurado o fallo de envio)`,
      );
      throw new BadRequestException({
        message:
          "No fue posible enviar tu mensaje en este momento. Intenta nuevamente mas tarde.",
      });
    }

    // M18: Redact email + sanitize name/subject to prevent CRLF log injection
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
