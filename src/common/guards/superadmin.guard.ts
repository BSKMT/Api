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
  };
}

/**
 * SuperAdminGuard — Strictly restricts execution exclusively to accounts with
 * the role of SUPERADMIN. Must be preceded by SessionGuard.
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedSuperAdminRequest>();

    if (!request.user?.userId) {
      throw new ForbiddenException("Acceso denegado — sesión no autenticada");
    }

    if (request.user.role !== UserRole.SUPERADMIN) {
      throw new ForbiddenException(
        "Acceso denegado — Esta operación requiere privilegios exclusivos de Superadministrador (Owner).",
      );
    }

    return true;
  }
}
