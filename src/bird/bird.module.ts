import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { User, UserSchema } from "../users/schemas/user.schema";
import { BirdService } from "./bird.service";
import { BirdEmailService } from "./bird-email.service";
import { BirdSmsService } from "./bird-sms.service";
import { BirdWhatsappService } from "./bird-whatsapp.service";
import { BirdNotifyService } from "./bird-notify.service";
import { BirdRealtimeService } from "./bird-realtime.service";
import { BirdRealtimeController } from "./bird-realtime.controller";

/**
 * BirdModule — Proveedor unico para todos los servicios Bird:
 *
 *  - `BirdService`            — wrapper del SDK BirdClient (shared, lazy ESM import).
 *  - `BirdEmailService`       — envio de correos transaccionales (reemplaza Zoho).
 *  - `BirdSmsService`         — envio de SMS transaccionales.
 *  - `BirdWhatsappService`    — envio de mensajes WhatsApp transaccionales.
 *  - `BirdNotifyService`      — dispatcher multicanal basado en preferencias de
 *                               usuario (email + SMS + WhatsApp segun settings).
 *  - `BirdRealtimeService`    — publish de eventos WebSocket, member events,
 *                               channel state queries, webhook verification.
 *  - `BirdRealtimeController`  — endpoints de auth de member/channel + webhook.
 *
 * Exporta `BirdEmailService` (para Better Auth, Contact),
 * `BirdNotifyService` (para NotificationsService),
 * `BirdRealtimeService` (para NotificationsService, AuthController, etc.),
 * `BirdWhatsappService` (para ChannelVerificationService, futuro uso directo),
 * y `BirdService` (para inyeccion directa si se necesita).
 */
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
  ],
  exports: [
    BirdEmailService,
    BirdSmsService,
    BirdWhatsappService,
    BirdNotifyService,
    BirdRealtimeService,
    BirdService,
  ],
})
export class BirdModule {}
