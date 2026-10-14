import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { ROLES_KEY, Role } from "../decorators/roles.decorator";

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

    // Validación granular de permisos por módulo para administradores
    if (
      userRole === Role.ADMIN &&
      Array.isArray(user.adminPermissions) &&
      user.adminPermissions.length > 0
    ) {
      const url = (request.originalUrl || request.url || "").toLowerCase();

      const moduleMap: Record<string, string> = {
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

      for (const [routePrefix, requiredPerm] of Object.entries(moduleMap)) {
        if (url.includes(routePrefix)) {
          const hasPerm =
            user.adminPermissions.includes(requiredPerm) ||
            (requiredPerm === "arpha" &&
              user.adminPermissions.includes("events"));
          if (!hasPerm) {
            throw new ForbiddenException(
              `No tienes permisos asignados para el módulo administrativo '${requiredPerm}'. Contacta a un Superadministrador.`,
            );
          }
          break;
        }
      }
    }

    return true;
  }
}
