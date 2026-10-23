import { Logger } from "@nestjs/common";
import { BirdEmailService } from "../../bird/bird-email.service";
import { BirdSmsService } from "../../bird/bird-sms.service";
import { BirdWhatsappService } from "../../bird/bird-whatsapp.service";
import { TicketDocument, TicketChannel } from "../schemas/ticket.schema";
import { maskEmail, maskPhone } from "../../common/utils/log-redact.util";
import { normalizePhoneNumberHelper } from "../../bird/bird-contact-extraction.helpers";
import { TicketNotificationContext } from "./ticket-creation-notifications.helper";

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
