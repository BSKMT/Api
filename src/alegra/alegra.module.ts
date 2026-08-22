import { Module, Global } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { AlegraController } from "./alegra.controller";
import { AlegraService } from "./alegra.service";
import {
  AlegraInvoice,
  AlegraInvoiceSchema,
} from "./schemas/alegra-invoice.schema";
import { UsersModule } from "../users/users.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { KvModule } from "../kv/kv.module";

/**
 * AlegraModule — Módulo global para la integración con Alegra.
 *
 * Es @Global() para que AlegraService esté disponible en todos los
 * módulos que necesitan facturación (payments, membership, shop,
 * events, arpha) sin importar explícitamente este módulo en cada uno.
 *
 * Seguridad (OWASP A10:2025):
 * Si ALEGRA_ENABLED es false o las credenciales no están configuradas,
 * AlegraService.isConfigured() retorna false y todas las operaciones
 * degradan a no-ops — el flujo de pago nunca se interrumpe.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AlegraInvoice.name, schema: AlegraInvoiceSchema },
    ]),
    UsersModule,
    NotificationsModule,
    KvModule,
  ],
  controllers: [AlegraController],
  providers: [AlegraService],
  exports: [AlegraService],
})
export class AlegraModule {}
