import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Req,
  Res,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { LoginOtpService } from "./login-otp.service";
import {
  LoginOtpInitiateDto,
  LoginOtpFasciaInitiateDto,
  LoginOtpConsoleInitiateDto,
  LoginOtpSuperAdminInitiateDto,
  LoginOtpVerifyDto,
} from "./dto/login-otp.dto";
import { Public } from "../common/decorators";

/**
 * LoginOtpController — Endpoints para el flujo de verificacion de login
 * por codigo alfanumerico obligatorio.
 *
 * Flujos segregados por panel:
 *  - POST /api/auth/login-otp/initiate           — Usuario general (dash.bskmt.com)
 *  - POST /api/auth/login-otp/fascia/initiate    — Colaboradores / Operaciones (panel.bskmt.com)
 *  - POST /api/auth/login-otp/console/initiate   — Administración Ejecutiva (console.bskmt.com)
 *  - POST /api/auth/login-otp/superadmin/initiate — Superadministradores (Owners / New-BSKMT)
 *  - POST /api/auth/login-otp/verify             — Verificación de código OTP para todos los paneles
 *
 * Rate limiting (OWASP A07:2025 — mitigar credential stuffing y brute force):
 *  - initiate: 3 req / 60s / IP  (limita intentos de adivinar credenciales)
 *  - verify:   10 req / 60s / IP (limita intentos de adivinar el codigo)
 */
@Controller("auth/login-otp")
export class LoginOtpController {
  constructor(private readonly loginOtpService: LoginOtpService) {}

  @Public()
  @Post("initiate")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  async initiate(
    @Body() dto: LoginOtpInitiateDto,
    @Req() req: Request,
  ): Promise<{ requestId: string }> {
    const clientIp = req.ip ?? "";
    const userAgent = req.headers["user-agent"] ?? "";
    return this.loginOtpService.initiateLogin(
      dto.email,
      dto.password,
      dto.rememberMe,
      clientIp,
      userAgent,
    );
  }

  @Public()
  @Post("fascia/initiate")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  async initiateFascia(
    @Body() dto: LoginOtpFasciaInitiateDto,
    @Req() req: Request,
  ): Promise<{ requestId: string }> {
    const clientIp = req.ip ?? "";
    const userAgent = req.headers["user-agent"] ?? "";
    return this.loginOtpService.initiateFasciaLogin(
      dto.username,
      dto.password,
      dto.rememberMe,
      clientIp,
      userAgent,
    );
  }

  @Public()
  @Post("console/initiate")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  async initiateConsole(
    @Body() dto: LoginOtpConsoleInitiateDto,
    @Req() req: Request,
  ): Promise<{ requestId: string }> {
    const clientIp = req.ip ?? "";
    const userAgent = req.headers["user-agent"] ?? "";
    return this.loginOtpService.initiateConsoleLogin(
      dto.email,
      dto.username,
      dto.password,
      dto.rememberMe,
      clientIp,
      userAgent,
    );
  }

  @Public()
  @Post("superadmin/initiate")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  async initiateSuperAdmin(
    @Body() dto: LoginOtpSuperAdminInitiateDto,
    @Req() req: Request,
  ): Promise<{ requestId: string }> {
    const clientIp = req.ip ?? "";
    const userAgent = req.headers["user-agent"] ?? "";
    return this.loginOtpService.initiateSuperAdminLogin(
      dto.email,
      dto.username,
      dto.password,
      dto.rememberMe,
      clientIp,
      userAgent,
    );
  }

  @Public()
  @Post("verify")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async verify(
    @Body() dto: LoginOtpVerifyDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ cookies: string[]; message?: string }> {
    const result = await this.loginOtpService.verifyOtp(
      dto.requestId,
      dto.code,
    );
    if (result.setCookieHeaders && Array.isArray(result.setCookieHeaders)) {
      for (const cookie of result.setCookieHeaders) {
        res.append("Set-Cookie", cookie);
      }
    }

    return {
      cookies: result.cookies ?? [],
      message: "Sesión iniciada exitosamente",
    };
  }
}
