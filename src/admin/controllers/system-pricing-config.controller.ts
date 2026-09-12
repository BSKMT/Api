import {
  Controller,
  Get,
  Put,
  Body,
  Req,
  Res,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { SessionGuard } from "../../auth/session.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles, Role } from "../../common/decorators";
import { SystemPricingConfigService } from "../services/system-pricing-config.service";
import { UpdateSystemPricingConfigDto } from "../dto/system-pricing-config.dto";

interface AuthenticatedRequest extends Request {
  user: { userId: string; email?: string; role?: string };
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

  @Get("pricing")
  @Throttle({ default: { ttl: 60000, limit: 120 } })
  async getPublicPricing(
    @Query("seasonYear") seasonYearStr?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    if (res) {
      res.setHeader(
        "Cache-Control",
        "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
      );
    }
    const seasonYear = seasonYearStr
      ? Number.parseInt(seasonYearStr, 10)
      : undefined;
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
  async getAdminPricing(@Query("seasonYear") seasonYearStr?: string) {
    const seasonYear = seasonYearStr
      ? Number.parseInt(seasonYearStr, 10)
      : undefined;
    return this.pricingConfigService.getConfig(seasonYear);
  }

  @Put()
  @Throttle({ medium: { ttl: 60000, limit: 20 } })
  @HttpCode(HttpStatus.OK)
  async updateAdminPricing(
    @Req() req: AuthenticatedRequest,
    @Body() dto: UpdateSystemPricingConfigDto,
  ) {
    return this.pricingConfigService.updateConfig(dto, req.user.userId);
  }
}
