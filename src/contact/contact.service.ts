import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { EmailService } from "../zoho-mail/email.service";
import { ContactDto } from "./dto/contact.dto";

/**
 * ContactService - Orquesta el envio de correos para el formulario de
 * contacto publico de la landing page.
 *
 * Envia dos correos a traves de Zoho Mail:
 *  1. Correo interno con los datos del contacto al equipo BSK.
 *  2. Auto-respuesta de confirmacion al remitente.
 *
 * Si Zoho Mail no esta configurado, el metodo lanza un BadRequestException
 * para que el frontend informe al usuario de forma clara, evitando prometer
 * una entrega que no ocurrira.
 */
@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);

  constructor(private readonly emailService: EmailService) {}

  async handleContact(dto: ContactDto): Promise<{
    message: string;
    delivered: boolean;
  }> {
    const { delivered } = await this.emailService.sendContactMessages({
      name: dto.name,
      email: dto.email,
      subject: dto.subject,
      message: dto.message,
      source: "Formulario de contacto web",
    });

    if (!delivered) {
      this.logger.warn(
        `Contacto de ${dto.email} registrado pero no entregado por correo (Zoho no configurado o fallo de envio)`,
      );
      throw new BadRequestException({
        message:
          "No fue posible enviar tu mensaje en este momento. Intenta nuevamente mas tarde.",
      });
    }

    this.logger.log(`Mensaje de contacto recibido de ${dto.email}`);
    return {
      message:
        "Hemos recibido tu mensaje. Te contactaremos en un maximo de 48 horas habiles.",
      delivered: true,
    };
  }
}
