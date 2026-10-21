import { Injectable, Logger } from "@nestjs/common";
import { BirdService } from "./bird.service";
import * as templates from "./email.templates";
import * as renderers from "./templates";
import { maskEmail } from "../common/utils/log-redact.util";
import {
  formatBirdError,
  renderWithFallback,
  buildTicketAttachments,
  buildTicketSubject,
  getDefaultEmailSender,
} from "./bird-email.helpers";

@Injectable()
export class BirdEmailService {
  private readonly logger = new Logger(BirdEmailService.name);
  private readonly sender = getDefaultEmailSender();

  constructor(private readonly birdService: BirdService) {}

  private getFrom(): { email: string; name?: string } {
    return { email: this.sender.fromEmail, name: this.sender.fromName };
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
        () => renderers.renderContactInternal(data),
        () =>
          templates.contactInternalTemplate({
            ...data,
            source: data.source ?? "Formulario de contacto web",
          }),
        this.logger,
        "contacto",
      );

      await client.email.send({
        from: this.getFrom(),
        to: [this.sender.teamEmail],
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
        () => renderers.renderNotification(data),
        () => templates.notificationTemplate(data),
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
        () => renderers.renderEmailVerification(data),
        () => templates.emailVerificationTemplate(data),
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
        () => renderers.renderPasswordReset(data),
        () => templates.passwordResetTemplate(data),
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
        () => renderers.renderTicketNotification(data),
        () => templates.ticketNotificationTemplate(data),
        this.logger,
        "ticket",
      );

      const attachments = buildTicketAttachments(
        data.checkInCode,
        data.pdfBuffer,
      );
      const subject = buildTicketSubject(data.type, data.title);

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
