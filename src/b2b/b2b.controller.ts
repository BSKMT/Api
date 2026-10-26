import {
  Controller,
  Post,
  Body,
  Ip,
  Logger,
  HttpCode,
  HttpStatus,
  Req,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import { B2bService } from "./b2b.service";
import { B2bContactDto } from "./dto/b2b-contact.dto";
import { Public } from "../common/decorators";
import { verifyTurnstileToken } from "../common/utils/turnstile.util";

@Controller("b2b")
export class B2bController {
  private readonly logger = new Logger(B2bController.name);

  constructor(private readonly b2bService: B2bService) {}

  @Public()
  @Throttle({ medium: { ttl: 60000, limit: 5 } })
  @Post("contact")
  @HttpCode(HttpStatus.CREATED)
  async submitContact(
    @Body() dto: B2bContactDto,
    @Req() req?: Request & { cfOriginVerified?: boolean },
    @Ip() ip?: string,
  ) {
    const edgeVerified =
      Boolean(req?.cfOriginVerified) &&
      req?.headers?.["x-turnstile-verified"] === "1";
    if (!edgeVerified) {
      await verifyTurnstileToken(dto.turnstileToken, ip, this.logger);
    }
    await this.b2bService.createContact(dto);
    return {
      message:
        "Propuesta recibida. Nuestro equipo te contactara en un maximo de 48 horas habiles.",
    };
  }
}
