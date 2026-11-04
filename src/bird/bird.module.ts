import { Global, Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { User, UserSchema } from "../users/schemas/user.schema";
import { BirdService } from "./bird.service";
import { BirdEmailService } from "./bird-email.service";
import { BirdSmsService } from "./bird-sms.service";
import { BirdWhatsappService } from "./bird-whatsapp.service";
import { BirdNotifyService } from "./bird-notify.service";
import { BirdRealtimeService } from "./bird-realtime.service";
import { BirdRealtimeController } from "./bird-realtime.controller";
import { BirdContactService } from "./bird-contact.service";

/**
 * BirdModule — Proveedor unico para todos los servicios Bird:
 *
 *  - `BirdService`            — wrapper del SDK BirdClient (shared, lazy ESM import).
 *  - `BirdContactService`     — sincronizacion de contactos y audiencias CRM (usuarios, miembros, empleados).
 *  - `BirdEmailService`       — envio de correos transaccionales (reemplaza Zoho).
 *  - `BirdSmsService`         — envio de SMS transaccionales.
 *  - `BirdWhatsappService`    — envio de mensajes WhatsApp transaccionales.
 *  - `BirdNotifyService`      — dispatcher multicanal basado en preferencias de
 *                               usuario (email + SMS + WhatsApp segun settings).
 *  - `BirdRealtimeService`    — publish de eventos WebSocket, member events,
 *                               channel state queries, webhook verification.
 *  - `BirdRealtimeController`  — endpoints de auth de member/channel + webhook.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
  ],
  controllers: [BirdRealtimeController],
  providers: [
    BirdService,
    BirdEmailService,
    BirdSmsService,
    BirdWhatsappService,
    BirdNotifyService,
    BirdRealtimeService,
    BirdContactService,
  ],
  exports: [
    BirdEmailService,
    BirdSmsService,
    BirdWhatsappService,
    BirdNotifyService,
    BirdRealtimeService,
    BirdContactService,
    BirdService,
  ],
})
export class BirdModule {}
