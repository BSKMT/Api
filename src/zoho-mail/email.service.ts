import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { EnvironmentConfig } from "../config/config.interface";
import { ZohoMailService } from "./zoho-mail.service";
import {
  contactAutoReplyTemplate,
  contactInternalTemplate,
  emailVerificationTemplate,
  notificationTemplate,
  passwordResetTemplate,
} from "./email.templates";

/**
 * EmailService - Fachada de alto nivel para el envio de correos
 * transaccionales a traves de Zoho Mail.
 *
 * Oculta el token, las plantillas y el remitente por defecto (ZOHO_FROM_ADDRESS)
 * detras de metodos orientados al dominio (contacto, auto-respuesta y
 * notificaciones del sistema). Si Zoho no esta configurado, los metodos
 * operan en modo degradado (no-op) sin lanzar errores, para no romper flujos
 * críticos del negocio.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    private readonly zohoMailService: ZohoMailService,
    private readonly configService: ConfigService<EnvironmentConfig, true>,
  ) {}

  private getFromAddress(): string {
    return (
      this.configService.get("ZOHO_FROM_ADDRESS", { infer: true }) ||
      "no-reply@bskmt.com"
    );
  }

  /**
   * Envia el correo interno al equipo BSK y la auto-respuesta al visitante
   * cuando se envia el formulario de contacto publico de la landing page.
   */
  async sendContactMessages(data: {
    name: string;
    email: string;
    subject: string;
    message: string;
    source?: string;
  }): Promise<{ delivered: boolean }> {
    if (!this.zohoMailService.isConfigured()) {
      this.logger.warn("Zoho Mail no configurado: contacto omitido");
      return { delivered: false };
    }

    const teamEmail =
      this.configService.get("ZOHO_TEAM_EMAIL", { infer: true }) ||
      this.getFromAddress();

    const [internalResult, autoReplyResult] = await Promise.all([
      this.zohoMailService.sendEmail({
        fromAddress: this.getFromAddress(),
        toAddress: teamEmail,
        subject: `[Contacto web] ${data.subject}`,
        content: contactInternalTemplate({
          name: data.name,
          email: data.email,
          subject: data.subject,
          message: data.message,
          source: data.source ?? "Formulario de contacto web",
        }),
      }),
      this.zohoMailService.sendEmail({
        fromAddress: this.getFromAddress(),
        toAddress: data.email,
        subject: "Hemos recibido tu mensaje — BSK Motorcycle Team",
        content: contactAutoReplyTemplate(data.name),
      }),
    ]);

    return { delivered: internalResult.ok && autoReplyResult.ok };
  }

  /**
   * Envia un correo transaccional asociado a una notificacion del sistema
   * (por ejemplo, activacion de membresia o rechazo de pago).
   */
  async sendNotificationEmail(data: {
    to: string;
    title: string;
    message: string;
  }): Promise<boolean> {
    if (!this.zohoMailService.isConfigured()) {
      return false;
    }

    const result = await this.zohoMailService.sendEmail({
      fromAddress: this.getFromAddress(),
      toAddress: data.to,
      subject: data.title,
      content: notificationTemplate({
        title: data.title,
        message: data.message,
      }),
    });
    return result.ok;
  }

  /**
   * Envia el correo de verificacion de correo electronico usando el
   * enlace generado por Better Auth. Se llama desde el callback
   * `emailVerification.sendVerificationEmail` en la configuracion de
   * Better Auth.
   */
  async sendVerificationEmail(data: {
    to: string;
    name: string;
    verificationUrl: string;
  }): Promise<boolean> {
    if (!this.zohoMailService.isConfigured()) {
      return false;
    }

    const result = await this.zohoMailService.sendEmail({
      fromAddress: this.getFromAddress(),
      toAddress: data.to,
      subject: "Verifica tu correo — BSK Motorcycle Team",
      content: emailVerificationTemplate({
        name: data.name,
        verificationUrl: data.verificationUrl,
      }),
    });
    return result.ok;
  }

  /**
   * Envia el correo de restablecimiento de contrasena usando el
   * enlace generado por Better Auth. Se llama desde el callback
   * `emailAndPassword.sendResetPassword` en la configuracion de
   * Better Auth.
   */
  async sendPasswordResetEmail(data: {
    to: string;
    name: string;
    resetUrl: string;
  }): Promise<boolean> {
    if (!this.zohoMailService.isConfigured()) {
      return false;
    }

    const result = await this.zohoMailService.sendEmail({
      fromAddress: this.getFromAddress(),
      toAddress: data.to,
      subject: "Restablece tu contrasena — BSK Motorcycle Team",
      content: passwordResetTemplate({
        name: data.name,
        resetUrl: data.resetUrl,
      }),
    });
    return result.ok;
  }
}
