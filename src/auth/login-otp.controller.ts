import { Controller, Post, Body, HttpCode, HttpStatus } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { LoginOtpService } from "./login-otp.service";
import { LoginOtpInitiateDto, LoginOtpVerifyDto } from "./dto/login-otp.dto";
import { Public } from "../common/decorators";

/**
 * LoginOtpController — Endpoints para el flujo de verificacion de login
 * por codigo alfanumerico obligatorio.
 *
 * Flujo:
 *  1. POST /api/auth/login-otp/initiate — Valida credenciales y envia codigo.
 *  2. POST /api/auth/login-otp/verify    — Verifica codigo y entrega sesion.
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
  ): Promise<{ requestId: string }> {
    return this.loginOtpService.initiateLogin(
      dto.email,
      dto.password,
      dto.rememberMe,
    );
  }

  @Public()
  @Post("verify")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async verify(@Body() dto: LoginOtpVerifyDto): Promise<{ cookies: string[] }> {
    return this.loginOtpService.verifyOtp(dto.requestId, dto.code);
  }
}
