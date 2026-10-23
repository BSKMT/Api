import { Logger } from "@nestjs/common";
import { BirdEmailService } from "../../bird/bird-email.service";
import { BirdSmsService } from "../../bird/bird-sms.service";
import { BirdWhatsappService } from "../../bird/bird-whatsapp.service";
import { BirdRealtimeService } from "../../bird/bird-realtime.service";
import { TicketDocument, TicketPriority } from "../schemas/ticket.schema";
import { maskEmail, maskPhone } from "../../common/utils/log-redact.util";
import { normalizePhoneNumberHelper } from "../../bird/bird-contact-extraction.helpers";

export interface TicketNotificationContext {
  birdEmailService: BirdEmailService;
  birdSmsService?: BirdSmsService;
  birdWhatsappService?: BirdWhatsappService;
  birdRealtimeService?: BirdRealtimeService;
  logger: Logger;
}

async function dispatchCreationEmail(
  birdEmailService: BirdEmailService,
  ticket: TicketDocument,
  logger: Logger,
): Promise<void> {
  const isUrgent = ticket.priority === TicketPriority.URGENTE;
  const slaHours = isUrgent ? "2 horas" : "24 a 48 horas";
  try {
    const emailBody = `Hola ${ticket.customer.name},\n\nHemos recibido tu solicitud de soporte #${ticket.ticketNumber} con asunto: "${ticket.subject}".\n\nNuestro equipo de Concierge y Atención al Cliente se encuentra procesándola. Tiempo estimado de primera respuesta: <${slaHours}.\n\nPuedes responder a este correo, escribirnos por WhatsApp (+57 316 958 8444) o ingresar a tu panel en https://panel.bskmt.com/soporte para ver el estado de tu trámite.`;

    await birdEmailService.sendNotificationEmail({
      to: ticket.customer.email,
      title: `[Ticket #${ticket.ticketNumber}] Solicitud Recibida: ${ticket.subject}`,
      message: emailBody,
    });
    logger.log(
      `Confirmación de ticket #${ticket.ticketNumber} enviada por correo a ${maskEmail(ticket.customer.email)}`,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(
      `No se pudo enviar correo de confirmación de ticket #${ticket.ticketNumber}: ${msg}`,
    );
  }
}

async function dispatchCreationWhatsapp(
  birdWhatsappService: BirdWhatsappService,
  ticket: TicketDocument,
  phone: string,
  logger: Logger,
): Promise<void> {
  try {
    const waMessage = `¡Hola ${ticket.customer.name}! 👋 Hemos recibido tu solicitud [Ticket #${ticket.ticketNumber}]: "${ticket.subject}". Nuestro equipo de concierge te atenderá a la mayor brevedad. Si necesitas enviar fotos o detalles adicionales, puedes responder directamente aquí.`;

    await birdWhatsappService.sendNotificationWhatsapp({
      to: phone,
      title: `Servicio al Cliente BSKMT #${ticket.ticketNumber}`,
      message: waMessage,
    });
    logger.log(
      `Confirmación WhatsApp de ticket #${ticket.ticketNumber} enviada a ${maskPhone(phone)}`,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(
      `Error al enviar confirmación WhatsApp para ticket #${ticket.ticketNumber}: ${msg}`,
    );
  }
}

async function dispatchCreationSms(
  birdSmsService: BirdSmsService,
  ticket: TicketDocument,
  phone: string,
  logger: Logger,
): Promise<void> {
  try {
    const smsMessage = `BSKMT: Recibimos tu solicitud [#${ticket.ticketNumber}]. Te atenderemos pronto. Consulta tu correo o WhatsApp oficial.`;

    await birdSmsService.sendNotificationSms({
      to: phone,
      title: `Ticket #${ticket.ticketNumber}`,
      message: smsMessage,
    });
    logger.log(
      `Confirmación SMS de ticket #${ticket.ticketNumber} enviada a ${maskPhone(phone)}`,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(
      `Error al enviar SMS para ticket #${ticket.ticketNumber}: ${msg}`,
    );
  }
}

function dispatchCreationRealtime(
  birdRealtimeService: BirdRealtimeService,
  ticket: TicketDocument,
  logger: Logger,
): void {
  void birdRealtimeService
    .publishToChannel("private-admin", "support.ticket_created", {
      ticketId: String(ticket._id),
      ticketNumber: ticket.ticketNumber,
      subject: ticket.subject,
      category: ticket.category,
      priority: ticket.priority,
      status: ticket.status,
      channel: ticket.channel,
      customer: ticket.customer,
      createdAt: ticket.createdAt,
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`Error al publicar evento realtime ticket_created: ${msg}`);
    });
}

export async function sendTicketCreationNotifications(
  ctx: TicketNotificationContext,
  ticket: TicketDocument,
): Promise<void> {
  const {
    birdEmailService,
    birdSmsService,
    birdWhatsappService,
    birdRealtimeService,
    logger,
  } = ctx;

  await dispatchCreationEmail(birdEmailService, ticket, logger);

  const normalizedPhone = normalizePhoneNumberHelper(ticket.customer.phone);
  if (normalizedPhone && birdWhatsappService) {
    await dispatchCreationWhatsapp(
      birdWhatsappService,
      ticket,
      normalizedPhone,
      logger,
    );
  }

  if (normalizedPhone && birdSmsService) {
    await dispatchCreationSms(birdSmsService, ticket, normalizedPhone, logger);
  }

  if (birdRealtimeService?.isRealtimeConfigured()) {
    dispatchCreationRealtime(birdRealtimeService, ticket, logger);
  }
}
