import { Controller, Get, Post, Body, Req, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import { SessionGuard } from "../auth/session.guard";
import { IdentityVerificationService } from "./identity-verification.service";
import { VerifyIdentityDto } from "./dto/verify-identity.dto";

interface AuthenticatedRequest extends Request {
  user: { userId: string };
}

/**
 * IdentityVerificationController — KYC endpoints backing the
 * "Identidad oficial" card in /panel/configuracion.
 *
 *  - GET  /api/profile/identity        → current verification status
 *  - POST /api/profile/identity/verify → run the Verifik check
 *
 * Both routes require an authenticated session (SessionGuard) and are
 * throttled because every verification attempt consumes Verifik
 * credits (financial DoS protection, OWASP A06/A07:2025).
 */
@Controller("profile/identity")
@UseGuards(SessionGuard)
export class IdentityVerificationController {
  constructor(private readonly identityService: IdentityVerificationService) {}

  @Get()
  async getStatus(@Req() req: AuthenticatedRequest) {
    return this.identityService.getStatus(req.user.userId);
  }

  @Post("verify")
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  async verify(
    @Req() req: AuthenticatedRequest,
    @Body() dto: VerifyIdentityDto,
  ) {
    return this.identityService.verifyIdentity(
      req.user.userId,
      dto.expeditionDate,
    );
  }
}
