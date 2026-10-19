import {
  Controller,
  Get,
  Put,
  Patch,
  Body,
  Req,
  Res,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { SessionGuard } from "../../auth/session.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles, Role, Public } from "../../common/decorators";
import { SystemPricingConfigService } from "../services/system-pricing-config.service";
import { UpdateSystemPricingConfigDto } from "../dto/system-pricing-config.dto";
import { ensureString } from "../../common/utils/sanitize-query.util";

interface AuthenticatedRequest extends Request {
  user: { userId: string; email?: string; role?: string };
}

function parseAndValidateSeasonYear(raw?: unknown): number | undefined {
  const str = ensureString(raw);
  if (!str?.trim()) return undefined;
  const parsed = Number.parseInt(str.trim(), 10);
  if (!Number.isInteger(parsed) || parsed < 2024 || parsed > 2035) {
    throw new BadRequestException(
      "El año de temporada (seasonYear) debe estar entre 2024 y 2035.",
    );
  }
  return parsed;
}

/**
 * Controlador PÚBLICO para consultar las tarifas vigentes,
 * consumido por la landing page, calculadora de ahorro y countdown.
 */
@Controller("config")
export class PublicPricingConfigController {
  constructor(
    private readonly pricingConfigService: SystemPricingConfigService,
  ) {}

  @Public()
  @Get("pricing")
  @Throttle({ default: { ttl: 60000, limit: 120 } })
  async getPublicPricing(
    @Query("seasonYear") seasonYearStr?: unknown,
    @Res({ passthrough: true }) res?: Response,
  ) {
    if (res) {
      res.setHeader(
        "Cache-Control",
        "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
      );
    }
    const seasonYear = parseAndValidateSeasonYear(seasonYearStr);
    return this.pricingConfigService.getConfig(seasonYear);
  }
}

/**
 * Controlador ADMINISTRATIVO para consultar y editar el tarifario global.
 * Protegido exclusivamente para usuarios con rol Role.ADMIN.
 */
@Controller("admin/config/pricing")
@UseGuards(SessionGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminPricingConfigController {
  constructor(
    private readonly pricingConfigService: SystemPricingConfigService,
  ) {}

  @Get()
  async getAdminPricing(@Query("seasonYear") seasonYearStr?: unknown) {
    const seasonYear = parseAndValidateSeasonYear(seasonYearStr);
    return this.pricingConfigService.getConfig(seasonYear);
  }

  @Put()
  @Patch()
  @Throttle({ medium: { ttl: 60000, limit: 20 } })
  @HttpCode(HttpStatus.OK)
  async updateAdminPricing(
    @Req() req: AuthenticatedRequest,
    @Body() dto: UpdateSystemPricingConfigDto,
  ) {
    return this.pricingConfigService.updateConfig(dto, req.user.userId);
  }
}
