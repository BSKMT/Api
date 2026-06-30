import { Module } from "@nestjs/common";
import { ZohoMailModule } from "../zoho-mail/zoho-mail.module";
import { ContactController } from "./contact.controller";
import { ContactService } from "./contact.service";

/**
 * ContactModule - Modulo del formulario de contacto publico.
 * Depende de ZohoMailModule para el envio real de los correos.
 */
@Module({
  imports: [ZohoMailModule],
  controllers: [ContactController],
  providers: [ContactService],
})
export class ContactModule {}
