import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { User, UserSchema } from "../users/schemas/user.schema";
import { BirdService } from "./bird.service";
import { BirdEmailService } from "./bird-email.service";
import { BirdSmsService } from "./bird-sms.service";
import { BirdNotifyService } from "./bird-notify.service";

/**
 * BirdModule — Proveedor unico para todos los servicios Bird:
 *
 *  - `BirdService`       — wrapper del SDK BirdClient (shared, lazy ESM import).
 *  - `BirdEmailService`  — envio de correos transaccionales (reemplaza Zoho).
 *  - `BirdSmsService`     — envio de SMS transaccionales (nuevo).
 *  - `BirdNotifyService` — dispatcher multicanal basado en preferencias de
 *                          usuario (email + SMS segun settings).
 *
 * Exporta `BirdEmailService` (para Better Auth, Contact) y
 * `BirdNotifyService` (para NotificationsService).
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
  ],
  providers: [BirdService, BirdEmailService, BirdSmsService, BirdNotifyService],
  exports: [BirdEmailService, BirdSmsService, BirdNotifyService, BirdService],
})
export class BirdModule {}
