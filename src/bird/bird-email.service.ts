import { Injectable, Logger } from "@nestjs/common";
import { BirdService } from "./bird.service";
import {
  contactInternalTemplate,
  emailVerificationTemplate,
  notificationTemplate,
  passwordResetTemplate,
} from "./email.templates";

/**
 * BirdEmailService — Fachada de alto nivel para el envio de correos
 * transaccionales a traves de Bird Email API.
 *
 * Reemplaza completamente al anterior `EmailService` (Zoho Mail) con la
 * misma interfaz publica, de modo que los consumidores (Better Auth,
 * NotificationsService, ContactService) no necesitan cambios.
 *
 * Bird Email API: `POST /v1/email/messages` via `bird.email.send()`.
 * El SDK inyecta `Idempotency-Key` automaticamente (safe retries).
 *
 * Seguridad (OWASP A04, A05, A07):
 *  - `category: "transactional"` en todos los envios para que Bird no
 *    aplique suppression de marketing.
 *  - El `from` debe estar en un dominio verificado en el workspace de
 *    Bird; si no, Bird rechaza con 422.
 *  - Las plantillas HTML escapan metacaracteres (escapeHtml) para
 *    prevenir XSS (A05:2025 — Injection).
 *  - Si Bird no esta configurado, los metodos operan en modo degradado
 *    (no-op + warn) sin lanzar errores, para no romper flujos criticos.
 */
@Injectable()
export class BirdEmailService {
  private readonly logger = new Logger(BirdEmailService.name);

  /** Remitente por defecto (variable de entorno). */
  private readonly fromEmail: string;
  /** Nombre a mostrar en el remitente. */
  private readonly fromName: string;
  /** Correo del equipo BSK para formularios de contacto. */
  private readonly teamEmail: string;

  constructor(private readonly birdService: BirdService) {
    this.fromEmail = process.env.BIRD_FROM_EMAIL ?? "no-reply@bskmt.com";
    this.fromName = process.env.BIRD_FROM_NAME ?? "BSK Motorcycle Team";
    this.teamEmail = process.env.BIRD_TEAM_EMAIL ?? "contacto@bskmt.com";
  }

  private getFrom(): string | { email: string; name?: string } {
    return { email: this.fromEmail, name: this.fromName };
  }

  /**
   * Envia el correo interno al equipo BSK cuando se envia el formulario
   * de contacto publico de la landing page. A7: no auto-respuesta al
   * remitente (elimina relay de spam/phishing).
   */
  async sendContactMessages(data: {
    name: string;
    email: string;
    subject: string;
    message: string;
    source?: string;
  }): Promise<{ delivered: boolean }> {
    if (!this.birdService.isConfigured()) {
      this.logger.warn("Bird no configurado: correo de contacto omitido");
      return { delivered: false };
    }

    try {
      const client = await this.birdService.getClient();
      await client.email.send({
        from: this.getFrom(),
        to: [this.teamEmail],
        subject: `[Contacto web] ${data.subject}`,
        html: contactInternalTemplate({
          name: data.name,
          email: data.email,
          subject: data.subject,
          message: data.message,
          source: data.source ?? "Formulario de contacto web",
        }),
        category: "transactional",
      });
      return { delivered: true };
    } catch (err: unknown) {
      this.logger.error(
        `Error enviando correo de contacto: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { delivered: false };
    }
  }

  /**
   * Envia un correo transaccional asociado a una notificacion del
   * sistema (membresia, pagos, etc.).
   */
  async sendNotificationEmail(data: {
    to: string;
    title: string;
    message: string;
  }): Promise<boolean> {
    if (!this.birdService.isConfigured()) return false;

    try {
      const client = await this.birdService.getClient();
      await client.email.send({
        from: this.getFrom(),
        to: [data.to],
        subject: data.title,
        html: notificationTemplate({
          title: data.title,
          message: data.message,
        }),
        category: "transactional",
      });
      return true;
    } catch (err: unknown) {
      this.logger.error(
        `Error enviando correo de notificacion: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  /**
   * Envia el correo de verificacion de correo electronico usando el
   * enlace generado por Better Auth.
   */
  async sendVerificationEmail(data: {
    to: string;
    name: string;
    verificationUrl: string;
  }): Promise<boolean> {
    if (!this.birdService.isConfigured()) return false;

    try {
      const client = await this.birdService.getClient();
      await client.email.send({
        from: this.getFrom(),
        to: [data.to],
        subject: "Verifica tu correo — BSK Motorcycle Team",
        html: emailVerificationTemplate({
          name: data.name,
          verificationUrl: data.verificationUrl,
        }),
        category: "transactional",
      });
      return true;
    } catch (err: unknown) {
      this.logger.error(
        `Error enviando correo de verificacion: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  /**
   * Envia el correo de restablecimiento de contrasena usando el enlace
   * generado por Better Auth.
   */
  async sendPasswordResetEmail(data: {
    to: string;
    name: string;
    resetUrl: string;
  }): Promise<boolean> {
    if (!this.birdService.isConfigured()) return false;

    try {
      const client = await this.birdService.getClient();
      await client.email.send({
        from: this.getFrom(),
        to: [data.to],
        subject: "Restablece tu contrasena — BSK Motorcycle Team",
        html: passwordResetTemplate({
          name: data.name,
          resetUrl: data.resetUrl,
        }),
        category: "transactional",
      });
      return true;
    } catch (err: unknown) {
      this.logger.error(
        `Error enviando correo de reset: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }
}
