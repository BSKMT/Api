import { Module } from "@nestjs/common";
import { BirdModule } from "../bird/bird.module";
import { ContactController } from "./contact.controller";
import { ContactService } from "./contact.service";
import { TicketsModule } from "../tickets/tickets.module";

/**
 * ContactModule - Modulo del formulario de contacto publico.
 * Integra BirdModule y TicketsModule para registrar tickets Zendesk-style.
 */
@Module({
  imports: [BirdModule, TicketsModule],
  controllers: [ContactController],
  providers: [ContactService],
})
export class ContactModule {}
