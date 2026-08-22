import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from "@nestjs/common";
import type { Request } from "express";
import { UsersService } from "../../users/users.service";

interface AuthenticatedRequest extends Request {
  user: { userId: string; email: string; role: string };
}

/**
 * IdentityVerifiedGuard — blocks transactional endpoints (membership
 * purchase, event/course registration, shop orders, ARPHA requests)
 * until the user has completed the official identity verification
 * (Verifik KYC).
 *
 * Applied at method level so it runs AFTER the class-level
 * SessionGuard, meaning `req.user` is already populated.
 *
 * Security (OWASP A01:2025 — Broken Access Control):
 *  - Server-side, authoritative enforcement: the flag is read from
 *    the database on every call — never from a client payload — so
 *    disabled JavaScript or crafted requests cannot bypass the gate.
 *  - The failure carries a stable error code
 *    (`identity_verification_required`) so the frontend can route
 *    the user to /panel/configuracion instead of showing a generic
 *    error.
 */
@Injectable()
export class IdentityVerifiedGuard implements CanActivate {
  constructor(private readonly usersService: UsersService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const user = await this.usersService.findById(request.user.userId);

    if (user?.identityVerified === true) {
      return true;
    }

    throw new ForbiddenException({
      statusCode: 403,
      error: "identity_verification_required",
      message:
        "Debes verificar tu identidad antes de realizar esta accion. Ve a Configuracion > Mi cuenta > Identidad oficial.",
    });
  }
}
