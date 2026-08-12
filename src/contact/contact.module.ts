import { Module } from "@nestjs/common";
import { BirdModule } from "../bird/bird.module";
import { ContactController } from "./contact.controller";
import { ContactService } from "./contact.service";

/**
 * ContactModule - Modulo del formulario de contacto publico.
 * Depende de BirdModule para el envio real de los correos.
 */
@Module({
  imports: [BirdModule],
  controllers: [ContactController],
  providers: [ContactService],
})
export class ContactModule {}
