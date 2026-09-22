import {
  Controller,
  Post,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { timingSafeEqual } from "node:crypto";
import { AlegraService } from "./alegra.service";
import { Public } from "../common/decorators";
import type { AlegraWebhookPayload } from "./alegra.interfaces";
import type { EnvironmentConfig } from "../config/config.interface";

/**
 * AlegraController — Expone el endpoint de webhook para recibir
 * notificaciones de eventos de Alegra (facturas, contactos, items).
 *
 * Seguridad (OWASP 2025):
 *  - A01: El endpoint es @Public() (sin SessionGuard) porque las
 *    notificaciones provienen de Alegra, no de un usuario autenticado.
 *    El middleware CSRF en main.ts exime esta ruta.
 *  - A08: El payload se trata como no confiable — todos los campos
 *    se validan en el servicio antes de usar.
 *  - A09: Todos los eventos se registran para auditoría.
 *  - A10: Los errores se manejan graceful — siempre se responde 200
 *    para que Alegra no reintente innecesariamente.
 *
 * Nota: Si ALEGRA_WEBHOOK_SECRET está configurado en variables de entorno,
 * se exige el parámetro ?token=<secret> para autenticar la procedencia.
 */
@Controller("alegra")
export class AlegraController {
  private readonly logger = new Logger(AlegraController.name);

  constructor(
    private readonly alegraService: AlegraService,
    private readonly configService: ConfigService<EnvironmentConfig>,
  ) {}

  /**
   * POST /api/alegra/webhook — Recibe notificaciones de eventos de Alegra.
   *
   * Alegra envía un POST con body vacío al crear la suscripción (prueba
   * de conectividad) y posteriormente POST con el payload del evento.
   * Se debe responder 2XX en menos de 5 segundos.
   */
  @Public()
  @Post("webhook")
  @HttpCode(HttpStatus.OK)
  async handleWebhook(@Body() body: unknown, @Query("token") token?: string) {
    const configuredSecret = this.configService.get<string>(
      "ALEGRA_WEBHOOK_SECRET",
      { infer: true },
    );
    if (configuredSecret) {
      const provided = token ?? "";
      const secretBuf = Buffer.from(configuredSecret);
      const providedBuf = Buffer.from(provided);
      if (
        providedBuf.length !== secretBuf.length ||
        !timingSafeEqual(providedBuf, secretBuf)
      ) {
        this.logger.warn(
          "Alegra webhook rejected: invalid or missing secret token",
        );
        throw new UnauthorizedException("Invalid webhook secret token");
      }
    }

    if (!body || typeof body !== "object" || Object.keys(body).length === 0) {
      this.logger.log("Alegra webhook connectivity check received");
      return { received: true };
    }

    await this.alegraService.handleWebhook(body as AlegraWebhookPayload);

    return { received: true };
  }
}
