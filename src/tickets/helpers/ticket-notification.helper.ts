import { Logger } from "@nestjs/common";
import { BirdEmailService } from "../../bird/bird-email.service";
import { BirdContactService } from "../../bird/bird-contact.service";
import { BirdSmsService } from "../../bird/bird-sms.service";
import { BirdWhatsappService } from "../../bird/bird-whatsapp.service";
import { BirdRealtimeService } from "../../bird/bird-realtime.service";
import {
  TicketDocument,
  TicketPriority,
  TicketChannel,
} from "../schemas/ticket.schema";
import { maskEmail, maskPhone } from "../../common/utils/log-redact.util";
import { normalizePhoneNumberHelper } from "../../bird/bird-contact-extraction.helpers";

export async function syncTicketCustomerWithBird(
  birdContactService: BirdContactService,
  customer: {
    name: string;
    email: string;
    phone?: string | null;
    userId?: string | null;
  },
  logger: Logger,
): Promise<string | null> {
  try {
    const parts = customer.name.trim().split(/\s+/);
    const primerNombre = parts[0] || customer.name;
    const primerApellido = parts.slice(1).join(" ") || undefined;
    const normalizedPhone = normalizePhoneNumberHelper(customer.phone);

    const res = await birdContactService.syncContact({
      email: customer.email,
      primerNombre,
      primerApellido,
      phone: normalizedPhone || undefined,
      externalId: customer.userId || undefined,
    });
    if (res.success && res.contactId) {
      logger.log(
        `Cliente ${maskEmail(customer.email)} sincronizado con Bird CRM: ${res.contactId}`,
      );
      return res.contactId;
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(
      `Error al sincronizar cliente ${maskEmail(customer.email)} en Bird CRM: ${msg}`,
    );
  }
  return null;
}

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

async function dispatchReplyEmail(
  birdEmailService: BirdEmailService,
  ticket: TicketDocument,
  replyContent: string,
  agentName: string,
  logger: Logger,
): Promise<void> {
  try {
    const textBody = `Estimado(a) ${ticket.customer.name},\n\n${agentName} del equipo de servicio al cliente ha respondido a tu ticket #${ticket.ticketNumber}:\n\n"${replyContent}"\n\nPuedes dar seguimiento y responder desde tu panel de usuario en https://panel.bskmt.com/soporte o respondiendo a este mensaje.`;

    await birdEmailService.sendNotificationEmail({
      to: ticket.customer.email,
      title: `[Ticket #${ticket.ticketNumber}] Respuesta: ${ticket.subject}`,
      message: textBody,
    });
    logger.log(
      `Notificación de respuesta de ticket #${ticket.ticketNumber} enviada por correo a ${maskEmail(ticket.customer.email)}`,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(
      `No se pudo enviar correo de respuesta de ticket #${ticket.ticketNumber}: ${msg}`,
    );
  }
}

async function dispatchReplyWhatsapp(
  birdWhatsappService: BirdWhatsappService,
  ticket: TicketDocument,
  replyContent: string,
  agentName: string,
  phone: string,
  logger: Logger,
): Promise<void> {
  try {
    const waMessage = `${agentName} (BSKMT Soporte): "${replyContent}"\n\nTicket #${ticket.ticketNumber}`;
    await birdWhatsappService.sendNotificationWhatsapp({
      to: phone,
      title: `Respuesta BSKMT #${ticket.ticketNumber}`,
      message: waMessage,
    });
    logger.log(
      `Respuesta WhatsApp de ticket #${ticket.ticketNumber} enviada a ${maskPhone(phone)}`,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(
      `Error al enviar respuesta WhatsApp para ticket #${ticket.ticketNumber}: ${msg}`,
    );
  }
}

async function dispatchReplySms(
  birdSmsService: BirdSmsService,
  ticket: TicketDocument,
  phone: string,
  logger: Logger,
): Promise<void> {
  try {
    const smsMessage = `BSKMT Soporte: Hay una nueva respuesta en tu Ticket #${ticket.ticketNumber}. Revisa tu correo o WhatsApp.`;
    await birdSmsService.sendNotificationSms({
      to: phone,
      title: `Ticket #${ticket.ticketNumber}`,
      message: smsMessage,
    });
    logger.log(
      `Alerta SMS de respuesta de ticket #${ticket.ticketNumber} enviada a ${maskPhone(phone)}`,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(
      `Error al enviar alerta SMS para ticket #${ticket.ticketNumber}: ${msg}`,
    );
  }
}

export async function sendTicketReplyNotifications(
  ctx: TicketNotificationContext,
  ticket: TicketDocument,
  replyContent: string,
  agentName: string,
  opts?: { isInternal?: boolean; sendSms?: boolean; sendWhatsapp?: boolean },
): Promise<void> {
  const {
    birdEmailService,
    birdSmsService,
    birdWhatsappService,
    birdRealtimeService,
    logger,
  } = ctx;

  if (birdRealtimeService?.isRealtimeConfigured()) {
    void birdRealtimeService.publishToChannel(
      "private-admin",
      "support.ticket_replied",
      {
        ticketId: String(ticket._id),
        ticketNumber: ticket.ticketNumber,
        isInternalNote: opts?.isInternal ?? false,
        reply: {
          senderName: agentName,
          content: replyContent,
          createdAt: new Date(),
        },
      },
    );
  }

  if (opts?.isInternal) {
    return;
  }

  await dispatchReplyEmail(
    birdEmailService,
    ticket,
    replyContent,
    agentName,
    logger,
  );

  const normalizedPhone = normalizePhoneNumberHelper(ticket.customer.phone);
  const shouldSendWhatsapp =
    opts?.sendWhatsapp ??
    (ticket.channel === TicketChannel.WHATSAPP || Boolean(normalizedPhone));

  if (normalizedPhone && birdWhatsappService && shouldSendWhatsapp) {
    await dispatchReplyWhatsapp(
      birdWhatsappService,
      ticket,
      replyContent,
      agentName,
      normalizedPhone,
      logger,
    );
  }

  const shouldSendSms = opts?.sendSms ?? ticket.channel === TicketChannel.SMS;

  if (normalizedPhone && birdSmsService && shouldSendSms) {
    await dispatchReplySms(birdSmsService, ticket, normalizedPhone, logger);
  }

  if (ticket.customer.userId && birdRealtimeService?.isRealtimeConfigured()) {
    void birdRealtimeService.publishToMember(
      ticket.customer.userId,
      "support.ticket_replied",
      {
        ticketId: String(ticket._id),
        ticketNumber: ticket.ticketNumber,
        reply: {
          senderName: agentName,
          content: replyContent,
          createdAt: new Date(),
        },
      },
    );
  }
}

// Backwards compatibility wrappers
export async function sendTicketCreationEmail(
  birdEmailService: BirdEmailService,
  ticket: TicketDocument,
  logger: Logger,
): Promise<void> {
  return sendTicketCreationNotifications({ birdEmailService, logger }, ticket);
}

export async function sendTicketReplyEmail(
  birdEmailService: BirdEmailService,
  ticket: TicketDocument,
  replyContent: string,
  agentName: string,
  logger: Logger,
): Promise<void> {
  return sendTicketReplyNotifications(
    { birdEmailService, logger },
    ticket,
    replyContent,
    agentName,
    { isInternal: false },
  );
}
