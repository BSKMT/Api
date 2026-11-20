import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Headers,
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
 * Nota: ALEGRA_WEBHOOK_SECRET es obligatorio en entorno y se autentica
 * exclusivamente vía cabeceras (`X-Webhook-Token` o `Authorization: Bearer`)
 * en tiempo constante (nunca por query string).
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
  async handleWebhook(
    @Body() body: unknown,
    @Headers("x-webhook-token") headerToken?: string,
    @Headers("authorization") authHeader?: string,
  ) {
    const configuredSecret = this.configService.get<string>(
      "ALEGRA_WEBHOOK_SECRET",
      { infer: true },
    );
    if (!configuredSecret) {
      this.logger.error(
        "ALEGRA_WEBHOOK_SECRET no está configurado en el entorno — rechazando webhook de facturación.",
      );
      throw new UnauthorizedException(
        "Autenticación de webhook de facturación no configurada.",
      );
    }

    // L-02: Require webhook secret via headers only (never URL query string, which leaks to logs).
    const bearer = authHeader?.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length)
      : undefined;
    const provided = headerToken ?? bearer ?? "";
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

    if (!body || typeof body !== "object" || Object.keys(body).length === 0) {
      this.logger.log("Alegra webhook connectivity check received");
      return { received: true };
    }

    await this.alegraService.handleWebhook(body as AlegraWebhookPayload);

    return { received: true };
  }
}
