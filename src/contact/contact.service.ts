import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { BirdEmailService } from "../bird/bird-email.service";
import { TicketsService } from "../tickets/tickets.service";
import {
  TicketCategory,
  TicketChannel,
  TicketPriority,
} from "../tickets/schemas/ticket.schema";
import { ContactDto } from "./dto/contact.dto";
import { maskEmail, sanitizeForLog } from "../common/utils/log-redact.util";
import { verifyTurnstileToken } from "../common/utils/turnstile.util";

/**
 * ContactService - Orquesta el registro de solicitudes de servicio al cliente
 * y notificaciones para el formulario publico de la landing page.
 */
@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);

  constructor(
    private readonly emailService: BirdEmailService,
    private readonly ticketsService: TicketsService,
  ) {}

  private mapSubjectToCategory(subject: string): TicketCategory {
    const s = subject.toLowerCase();
    if (s.includes("membres")) {
      return TicketCategory.MEMBRESIA;
    }
    if (s.includes("evento") || s.includes("rodada")) {
      return TicketCategory.EVENTOS;
    }
    if (s.includes("curso") || s.includes("academia")) {
      return TicketCategory.CURSOS;
    }
    if (s.includes("arpha") || s.includes("ruta") || s.includes("auxilio")) {
      return TicketCategory.ARPHA;
    }
    if (s.includes("tienda") || s.includes("pedido")) {
      return TicketCategory.TIENDA;
    }
    if (
      s.includes("habeas") ||
      s.includes("privacidad") ||
      s.includes("borrado")
    ) {
      return TicketCategory.HABEAS_DATA;
    }
    return TicketCategory.GENERAL;
  }

  async handleContact(
    dto: ContactDto,
    clientIp?: string,
  ): Promise<{
    message: string;
    delivered: boolean;
    ticketNumber?: string;
  }> {
    await verifyTurnstileToken(dto.captchaToken, clientIp, this.logger);

    let ticketNumber: string | undefined;
    try {
      const ticket = await this.ticketsService.createTicket(
        {
          subject: dto.subject,
          description: dto.message,
          category: this.mapSubjectToCategory(dto.subject),
          priority: TicketPriority.MEDIA,
          channel: TicketChannel.WEB_CONTACT,
          customerName: dto.name,
          customerEmail: dto.email,
          customerPhone: dto.phone,
          tags: ["landing_page", "contacto_web"],
        },
        undefined,
        clientIp,
      );
      ticketNumber = ticket.ticketNumber;
      this.logger.log(
        `Ticket de soporte creado: ${ticketNumber} para ${maskEmail(dto.email)}`,
      );
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Error al persistir ticket para ${maskEmail(dto.email)}: ${errMsg}`,
      );
    }

    const { delivered } = await this.emailService.sendContactMessages({
      name: dto.name,
      email: dto.email,
      subject: ticketNumber ? `[${ticketNumber}] ${dto.subject}` : dto.subject,
      message: dto.message,
      source: "Formulario de contacto web",
    });

    if (!delivered && !ticketNumber) {
      this.logger.warn(
        `Contacto de ${maskEmail(dto.email)} no registrado ni entregado`,
      );
      throw new BadRequestException({
        message:
          "No fue posible enviar tu mensaje en este momento. Intenta nuevamente mas tarde.",
      });
    }

    this.logger.log(
      `Mensaje de contacto procesado para ${maskEmail(dto.email)} asunto: ${sanitizeForLog(dto.subject)} ticket: ${ticketNumber}`,
    );

    return {
      message:
        "Hemos recibido tu mensaje y creado tu ticket de atención. Te contactaremos en un máximo de 48 horas hábiles.",
      delivered: true,
      ticketNumber,
    };
  }
}
