import { Logger } from "@nestjs/common";
import { BirdEmailService } from "../../bird/bird-email.service";
import { BirdContactService } from "../../bird/bird-contact.service";
import { TicketDocument, TicketPriority } from "../schemas/ticket.schema";
import { maskEmail } from "../../common/utils/log-redact.util";

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

    const res = await birdContactService.syncContact({
      email: customer.email,
      primerNombre,
      primerApellido,
      phone: customer.phone || undefined,
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

export async function sendTicketCreationEmail(
  birdEmailService: BirdEmailService,
  ticket: TicketDocument,
  logger: Logger,
): Promise<void> {
  try {
    const isUrgent = ticket.priority === TicketPriority.URGENTE;
    const slaHours = isUrgent ? "2 horas" : "24 a 48 horas";
    const textBody = `Hola ${ticket.customer.name},\n\nHemos recibido tu solicitud de soporte #${ticket.ticketNumber} con asunto: "${ticket.subject}".\n\nNuestro equipo de Concierge y Atención al Cliente se encuentra procesándola. Tiempo estimado de primera respuesta: <${slaHours}.\n\nPuedes responder a este correo o ingresar a tu panel para ver el estado de tu trámite.`;

    await birdEmailService.sendNotificationEmail({
      to: ticket.customer.email,
      title: `[Ticket #${ticket.ticketNumber}] Solicitud Recibida: ${ticket.subject}`,
      message: textBody,
    });
    logger.log(
      `Confirmación de ticket #${ticket.ticketNumber} enviada a ${maskEmail(ticket.customer.email)}`,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(
      `No se pudo enviar correo de confirmación de ticket #${ticket.ticketNumber}: ${msg}`,
    );
  }
}

export async function sendTicketReplyEmail(
  birdEmailService: BirdEmailService,
  ticket: TicketDocument,
  replyContent: string,
  agentName: string,
  logger: Logger,
): Promise<void> {
  try {
    const textBody = `Estimado(a) ${ticket.customer.name},\n\n${agentName} del equipo de servicio al cliente ha respondido a tu ticket #${ticket.ticketNumber}:\n\n"${replyContent}"\n\nPuedes dar seguimiento y responder desde tu panel de usuario en https://panel.bskmt.com/soporte.`;

    await birdEmailService.sendNotificationEmail({
      to: ticket.customer.email,
      title: `[Ticket #${ticket.ticketNumber}] Actualización: ${ticket.subject}`,
      message: textBody,
    });
    logger.log(
      `Notificación de respuesta de ticket #${ticket.ticketNumber} enviada a ${maskEmail(ticket.customer.email)}`,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(
      `No se pudo enviar correo de respuesta de ticket #${ticket.ticketNumber}: ${msg}`,
    );
  }
}
