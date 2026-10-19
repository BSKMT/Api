import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { ROLES_KEY, Role } from "../decorators/roles.decorator";

const ADMIN_MODULE_MAP: Record<string, string> = {
  "/api/admin/users": "users",
  "/api/admin/staff": "users",
  "/api/admin/courses": "courses",
  "/api/admin/events": "events",
  "/api/admin/shop": "store",
  "/api/admin/membership": "membership",
  "/api/admin/arpha": "arpha",
  "/api/admin/settings": "eliminations",
  "/api/admin/config": "config",
};

function checkAdminModulePermissions(permissions: string[], url: string): void {
  const lowerUrl = url.toLowerCase();
  for (const [routePrefix, requiredPerm] of Object.entries(ADMIN_MODULE_MAP)) {
    if (lowerUrl.includes(routePrefix)) {
      const hasPerm =
        permissions.includes(requiredPerm) ||
        (requiredPerm === "arpha" && permissions.includes("events"));
      if (!hasPerm) {
        throw new ForbiddenException(
          `No tienes permisos asignados para el módulo administrativo '${requiredPerm}'. Contacta a un Superadministrador.`,
        );
      }
      break;
    }
  }
}

/**
 * RolesGuard — checks that the authenticated user's role is in the
 * required roles list. The role is already populated on `req.user`
 * by `SessionGuard`, so no additional DB lookup is needed.
 *
 * Must be used AFTER `SessionGuard` in the `@UseGuards(...)` chain.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: { userId: string; role?: string } }>();

    if (request.method === "OPTIONS") {
      return true;
    }

    if (!request.user?.userId) {
      throw new ForbiddenException("Acceso denegado");
    }

    const user = request.user as {
      userId: string;
      role?: string;
      adminPermissions?: string[];
    };
    const userRole = user.role as Role;

    if (userRole === Role.SUPERADMIN) {
      return true;
    }

    if (!userRole || !requiredRoles.includes(userRole)) {
      throw new ForbiddenException(
        "No tienes permisos para realizar esta acción",
      );
    }

    // Validación granular de permisos por módulo para administradores (fail-closed)
    if (userRole === Role.ADMIN) {
      const perms = Array.isArray(user.adminPermissions)
        ? user.adminPermissions
        : [];
      if (!perms.includes("*")) {
        checkAdminModulePermissions(
          perms,
          request.originalUrl || request.url || "",
        );
      }
    }

    return true;
  }
}
