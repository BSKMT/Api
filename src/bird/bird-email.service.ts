import { Injectable, Logger } from "@nestjs/common";
import { BirdService } from "./bird.service";
import {
  contactInternalTemplate,
  emailVerificationTemplate,
  notificationTemplate,
  passwordResetTemplate,
} from "./email.templates";
import {
  renderContactInternal,
  renderEmailVerification,
  renderNotification,
  renderPasswordReset,
} from "./templates";
import { maskEmail } from "../common/utils/log-redact.util";

/**
 * BirdEmailService — Fachada de alto nivel para el envio de correos
 * transaccionales a traves de Bird Email API con plantillas modernas
 * desarrolladas con React Email.
 *
 * Mantiene la misma interfaz publica, de modo que los consumidores
 * (Better Auth, NotificationsService, ContactService) no necesitan cambios.
 *
 * Bird Email API: `POST /v1/email/messages` via `bird.email.send()`.
 * El SDK inyecta `Idempotency-Key` automaticamente (safe retries).
 *
 * Diseno y Visuales:
 *  - Plantillas modernas construidas con `@react-email/components`.
 *  - Doble formato: HTML responsivo y texto plano (multipart MIME) para
 *    maxima entregabilidad y compatibilidad con clientes de correo.
 *
 * Seguridad (OWASP A04, A05, A07, A10):
 *  - `category: "transactional"` en todos los envios para que Bird no
 *    aplique suppression de marketing.
 *  - El `from` debe estar en un dominio verificado en el workspace de
 *    Bird (bskmt.com con DKIM/SPF/DMARC en Cloudflare).
 *  - Si el renderizado de React Email falla por alguna razon inesperada,
 *    degrada de forma transparente a la plantilla HTML base (OWASP A10).
 *  - Logs enmascaran PII (maskEmail) para cumplimiento de privacidad.
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
    this.fromEmail = process.env.BIRD_FROM_EMAIL ?? "no_responder@bskmt.com";
    this.fromName = process.env.BIRD_FROM_NAME ?? "BSK Motorcycle Team";
    this.teamEmail = process.env.BIRD_TEAM_EMAIL ?? "contacto@bskmt.com";
  }

  private getFrom(): string | { email: string; name?: string } {
    return { email: this.fromEmail, name: this.fromName };
  }

  /**
   * Formatea errores del Bird SDK para logging diagnostico.
   * Extrae status code, error code y message de la respuesta HTTP
   * subyacente cuando estan disponibles (OWASP A09:2025 — logging adecuado).
   */
  private formatBirdError(err: unknown): string {
    if (err instanceof Error) {
      const parts: string[] = [err.message];
      const errAny = err as unknown as Record<string, unknown>;
      if (typeof errAny["status"] === "number") {
        parts.push(`(HTTP ${errAny["status"]})`);
      }
      if (typeof errAny["code"] === "string") {
        parts.push(`[code: ${errAny["code"]}]`);
      }
      if (
        typeof errAny["response"] === "object" &&
        errAny["response"] !== null
      ) {
        try {
          const body = JSON.stringify(errAny["response"]);
          parts.push(`body: ${body.slice(0, 200)}`);
        } catch {
          // response no serializable — omitir
        }
      }
      return parts.join(" ");
    }
    return String(err);
  }

  /**
   * Envia el correo interno al equipo BSK cuando se envia el formulario
   * de contacto publico de la landing page.
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
      let html: string;
      let text: string | undefined;

      try {
        const rendered = await renderContactInternal({
          name: data.name,
          email: data.email,
          subject: data.subject,
          message: data.message,
          source: data.source,
        });
        html = rendered.html;
        text = rendered.text;
      } catch (renderErr) {
        this.logger.warn(
          `Error en React Email (contacto): ${renderErr instanceof Error ? renderErr.message : String(renderErr)}. Usando plantilla de respaldo.`,
        );
        html = contactInternalTemplate({
          name: data.name,
          email: data.email,
          subject: data.subject,
          message: data.message,
          source: data.source ?? "Formulario de contacto web",
        });
      }

      await client.email.send({
        from: this.getFrom(),
        to: [this.teamEmail],
        subject: `[Contacto web] ${data.subject}`,
        html,
        ...(text ? { text } : {}),
        category: "transactional",
      });
      return { delivered: true };
    } catch (err: unknown) {
      this.logger.error(
        `Error enviando correo de contacto via Bird: ${this.formatBirdError(err)}`,
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
    if (!this.birdService.isConfigured()) {
      this.logger.warn("Bird no configurado: correo de notificacion omitido");
      return false;
    }

    try {
      const client = await this.birdService.getClient();
      let html: string;
      let text: string | undefined;

      try {
        const rendered = await renderNotification({
          title: data.title,
          message: data.message,
        });
        html = rendered.html;
        text = rendered.text;
      } catch (renderErr) {
        this.logger.warn(
          `Error en React Email (notificacion): ${renderErr instanceof Error ? renderErr.message : String(renderErr)}. Usando plantilla de respaldo.`,
        );
        html = notificationTemplate({
          title: data.title,
          message: data.message,
        });
      }

      await client.email.send({
        from: this.getFrom(),
        to: [data.to],
        subject: data.title,
        html,
        ...(text ? { text } : {}),
        category: "transactional",
      });
      return true;
    } catch (err: unknown) {
      this.logger.error(
        `Error enviando correo de notificacion via Bird: ${this.formatBirdError(err)}`,
      );
      return false;
    }
  }

  /**
   * Envia el correo de verificacion de correo electronico usando el
   * enlace generado por Better Auth con diseno React Email.
   */
  async sendVerificationEmail(data: {
    to: string;
    name: string;
    verificationUrl: string;
  }): Promise<boolean> {
    if (!this.birdService.isConfigured()) {
      this.logger.error(
        "sendVerificationEmail omitido — Bird no configurado (BIRD_API_KEY falta o tiene formato invalido)",
      );
      return false;
    }

    try {
      const client = await this.birdService.getClient();
      let html: string;
      let text: string | undefined;

      try {
        const rendered = await renderEmailVerification({
          name: data.name,
          verificationUrl: data.verificationUrl,
        });
        html = rendered.html;
        text = rendered.text;
      } catch (renderErr) {
        this.logger.warn(
          `Error en React Email (verificacion): ${renderErr instanceof Error ? renderErr.message : String(renderErr)}. Usando plantilla de respaldo.`,
        );
        html = emailVerificationTemplate({
          name: data.name,
          verificationUrl: data.verificationUrl,
        });
      }

      await client.email.send({
        from: this.getFrom(),
        to: [data.to],
        subject: "Verifica tu correo — BSK Motorcycle Team",
        html,
        ...(text ? { text } : {}),
        category: "transactional",
      });
      this.logger.log(
        `Correo de verificacion (React Email) enviado a ${maskEmail(data.to)} via Bird`,
      );
      return true;
    } catch (err: unknown) {
      this.logger.error(
        `Error enviando correo de verificacion via Bird: ${this.formatBirdError(err)}`,
      );
      return false;
    }
  }

  /**
   * Envia el correo de restablecimiento de contrasena usando el enlace
   * generado por Better Auth con diseno React Email.
   */
  async sendPasswordResetEmail(data: {
    to: string;
    name: string;
    resetUrl: string;
  }): Promise<boolean> {
    if (!this.birdService.isConfigured()) {
      this.logger.error(
        "sendPasswordResetEmail omitido — Bird no configurado (BIRD_API_KEY falta o tiene formato invalido)",
      );
      return false;
    }

    try {
      const client = await this.birdService.getClient();
      let html: string;
      let text: string | undefined;

      try {
        const rendered = await renderPasswordReset({
          name: data.name,
          resetUrl: data.resetUrl,
        });
        html = rendered.html;
        text = rendered.text;
      } catch (renderErr) {
        this.logger.warn(
          `Error en React Email (reset pass): ${renderErr instanceof Error ? renderErr.message : String(renderErr)}. Usando plantilla de respaldo.`,
        );
        html = passwordResetTemplate({
          name: data.name,
          resetUrl: data.resetUrl,
        });
      }

      await client.email.send({
        from: this.getFrom(),
        to: [data.to],
        subject: "Restablece tu contrasena — BSK Motorcycle Team",
        html,
        ...(text ? { text } : {}),
        category: "transactional",
      });
      this.logger.log(
        `Correo de reset (React Email) enviado a ${maskEmail(data.to)} via Bird`,
      );
      return true;
    } catch (err: unknown) {
      this.logger.error(
        `Error enviando correo de reset via Bird: ${this.formatBirdError(err)}`,
      );
      return false;
    }
  }
}
