import { Module } from "@nestjs/common";
import { ZohoMailService } from "./zoho-mail.service";
import { EmailService } from "./email.service";

/**
 * ZohoMailModule - Agrupa los proveedores de la integracion con Zoho Mail.
 *
 * Expone `EmailService` para que otros modulos (notifications, contact) puedan
 * enviar correos transaccionales sin conocer los detalles de OAuth ni HTTP.
 */
@Module({
  providers: [ZohoMailService, EmailService],
  exports: [EmailService, ZohoMailService],
})
export class ZohoMailModule {}
