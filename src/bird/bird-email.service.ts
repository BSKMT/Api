import { Injectable, Logger } from "@nestjs/common";
import { BirdService } from "./bird.service";
import {
  contactInternalTemplate,
  emailVerificationTemplate,
  notificationTemplate,
  passwordResetTemplate,
  ticketNotificationTemplate,
} from "./email.templates";
import {
  renderContactInternal,
  renderEmailVerification,
  renderNotification,
  renderPasswordReset,
  renderTicketNotification,
} from "./templates";
import { maskEmail } from "../common/utils/log-redact.util";
import { formatBirdError, renderWithFallback } from "./bird-email.helpers";

@Injectable()
export class BirdEmailService {
  private readonly logger = new Logger(BirdEmailService.name);
  private readonly fromEmail: string;
  private readonly fromName: string;
  private readonly teamEmail: string;

  constructor(private readonly birdService: BirdService) {
    this.fromEmail = process.env.BIRD_FROM_EMAIL ?? "no_responder@bskmt.com";
    this.fromName = process.env.BIRD_FROM_NAME ?? "BSK Motorcycle Team";
    this.teamEmail = process.env.BIRD_TEAM_EMAIL ?? "contacto@bskmt.com";
  }

  private getFrom(): { email: string; name?: string } {
    return { email: this.fromEmail, name: this.fromName };
  }

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
      const rendered = await renderWithFallback(
        () => renderContactInternal(data),
        () =>
          contactInternalTemplate({
            ...data,
            source: data.source ?? "Formulario de contacto web",
          }),
        this.logger,
        "contacto",
      );

      await client.email.send({
        from: this.getFrom(),
        to: [this.teamEmail],
        subject: `[Contacto web] ${data.subject}`,
        html: rendered.html,
        ...(rendered.text ? { text: rendered.text } : {}),
        category: "transactional",
      });
      return { delivered: true };
    } catch (err: unknown) {
      this.logger.error(
        `Error enviando correo de contacto via Bird: ${formatBirdError(err)}`,
      );
      return { delivered: false };
    }
  }

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
      const rendered = await renderWithFallback(
        () => renderNotification(data),
        () => notificationTemplate(data),
        this.logger,
        "notificacion",
      );

      await client.email.send({
        from: this.getFrom(),
        to: [data.to],
        subject: data.title,
        html: rendered.html,
        ...(rendered.text ? { text: rendered.text } : {}),
        category: "transactional",
      });
      return true;
    } catch (err: unknown) {
      this.logger.error(
        `Error enviando correo de notificacion via Bird: ${formatBirdError(err)}`,
      );
      return false;
    }
  }

  async sendVerificationEmail(data: {
    to: string;
    name: string;
    verificationUrl: string;
  }): Promise<boolean> {
    if (!this.birdService.isConfigured()) {
      this.logger.error("sendVerificationEmail omitido — Bird no configurado");
      return false;
    }

    try {
      const client = await this.birdService.getClient();
      const rendered = await renderWithFallback(
        () => renderEmailVerification(data),
        () => emailVerificationTemplate(data),
        this.logger,
        "verificacion",
      );

      await client.email.send({
        from: this.getFrom(),
        to: [data.to],
        subject: "Verifica tu correo — BSK Motorcycle Team",
        html: rendered.html,
        ...(rendered.text ? { text: rendered.text } : {}),
        category: "transactional",
      });
      this.logger.log(
        `Correo de verificacion enviado a ${maskEmail(data.to)} via Bird`,
      );
      return true;
    } catch (err: unknown) {
      this.logger.error(
        `Error enviando correo de verificacion via Bird: ${formatBirdError(err)}`,
      );
      return false;
    }
  }

  async sendPasswordResetEmail(data: {
    to: string;
    name: string;
    resetUrl: string;
  }): Promise<boolean> {
    if (!this.birdService.isConfigured()) {
      this.logger.error("sendPasswordResetEmail omitido — Bird no configurado");
      return false;
    }

    try {
      const client = await this.birdService.getClient();
      const rendered = await renderWithFallback(
        () => renderPasswordReset(data),
        () => passwordResetTemplate(data),
        this.logger,
        "reset pass",
      );

      await client.email.send({
        from: this.getFrom(),
        to: [data.to],
        subject: "Restablece tu contrasena — BSK Motorcycle Team",
        html: rendered.html,
        ...(rendered.text ? { text: rendered.text } : {}),
        category: "transactional",
      });
      this.logger.log(
        `Correo de reset enviado a ${maskEmail(data.to)} via Bird`,
      );
      return true;
    } catch (err: unknown) {
      this.logger.error(
        `Error enviando correo de reset via Bird: ${formatBirdError(err)}`,
      );
      return false;
    }
  }

  async sendTicketNotificationEmail(data: {
    to: string;
    recipientName: string;
    type: "EVENT" | "COURSE";
    title: string;
    slug: string;
    checkInCode: string;
    qrDataUrl: string;
    dateText: string;
    timeText?: string;
    locationText?: string;
    meetingPointText?: string;
    coordinatorName?: string;
    panelUrl: string;
    pdfBuffer?: Buffer;
  }): Promise<boolean> {
    if (!this.birdService.isConfigured()) {
      this.logger.warn(
        `Bird no configurado: correo de ticket para ${maskEmail(data.to)} omitido`,
      );
      return false;
    }

    try {
      const client = await this.birdService.getClient();
      const rendered = await renderWithFallback(
        () => renderTicketNotification(data),
        () => ticketNotificationTemplate(data),
        this.logger,
        "ticket",
      );

      const attachments = data.pdfBuffer
        ? [
            {
              filename: `Ticket-BSK-${data.checkInCode}.pdf`,
              content: data.pdfBuffer.toString("base64"),
              content_type: "application/pdf",
            },
          ]
        : undefined;

      const subject =
        data.type === "EVENT"
          ? `¡Tu registro está confirmado! Pase de Asistencia BSK · ${data.title}`
          : `¡Tu matrícula está confirmada! Ticket Oficial BSK Academy · ${data.title}`;

      await client.email.send({
        from: this.getFrom(),
        to: [data.to],
        subject,
        html: rendered.html,
        ...(rendered.text ? { text: rendered.text } : {}),
        category: "transactional",
        ...(attachments ? { attachments } : {}),
      });

      this.logger.log(
        `Ticket de ${data.type} (${data.checkInCode}) enviado exitosamente a ${maskEmail(data.to)} via Bird`,
      );
      return true;
    } catch (err: unknown) {
      this.logger.error(
        `Error enviando correo de ticket via Bird a ${maskEmail(data.to)}: ${formatBirdError(err)}`,
      );
      return false;
    }
  }
}
