import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from "@nestjs/common";
import type { Request } from "express";
import { UserRole } from "../../users/schemas/user.schema";

interface AuthenticatedSuperAdminRequest extends Request {
  user?: {
    userId: string;
    email?: string;
    role?: string;
    subrol?: string | null;
    authPortal?: string;
  };
}

const SUPERADMIN_ALLOWED_PORTALS = new Set<string>(["console", "superadmin"]);

/**
 * SuperAdminGuard — Strictly restricts execution exclusively to accounts with
 * the role of SUPERADMIN authenticated through a 4FA administrative portal
 * (`console` or `superadmin`). Rejects `standard` (2FA) and `fascia` (3FA)
 * sessions fail-closed. Must be preceded by SessionGuard.
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedSuperAdminRequest>();

    if (request.method === "OPTIONS") {
      return true;
    }

    if (!request.user?.userId) {
      throw new ForbiddenException("Acceso denegado — sesión no autenticada");
    }

    if (
      !request.user.authPortal ||
      !SUPERADMIN_ALLOWED_PORTALS.has(request.user.authPortal)
    ) {
      throw new ForbiddenException(
        "Acceso denegado — Esta operación requiere una sesión administrativa 4FA verificada (Console/Superadmin).",
      );
    }

    if (request.user.role !== UserRole.SUPERADMIN) {
      throw new ForbiddenException(
        "Acceso denegado — Esta operación requiere privilegios exclusivos de Superadministrador (Owner).",
      );
    }

    return true;
  }
}
