import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Get,
  Req,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import { ContactService } from "./contact.service";
import { ContactDto } from "./dto/contact.dto";
import { Public } from "../common/decorators";

/**
 * ContactController - Endpoint publico del formulario de contacto.
 * Expuesto en /api/contact (sin autenticacion) para que la landing page
 * pueda enviar mensajes de contacto que se entregan por correo.
 */
@Controller("contact")
export class ContactController {
  constructor(private readonly contactService: ContactService) {}

  /**
   * Endpoint de verificacion ligera para confirmar que el servicio
   * esta activo.
   * EVT-19: Removed output that could be used as delivery oracle.
   */
  @Public()
  @Get("health")
  @HttpCode(HttpStatus.OK)
  health() {
    return { ok: true };
  }

  @Public()
  @Throttle({ medium: { ttl: 60000, limit: 5 } })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async submit(
    @Body() dto: ContactDto,
    @Req() req: Request & { cfOriginVerified?: boolean },
  ) {
    const clientIp =
      (req.headers["cf-connecting-ip"] as string | undefined) || req.ip || "";
    const edgeVerified =
      Boolean(req.cfOriginVerified) &&
      req.headers["x-turnstile-verified"] === "1";
    return this.contactService.handleContact(dto, clientIp, edgeVerified);
  }
}
