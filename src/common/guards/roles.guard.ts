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

function getPathWithoutQuery(rawUrl: string): string {
  const qIdx = rawUrl.indexOf("?");
  return (qIdx === -1 ? rawUrl : rawUrl.slice(0, qIdx)).toLowerCase().trim();
}

function resolveRequiredPermission(cleanPath: string): string | null {
  for (const [routePrefix, requiredPerm] of Object.entries(ADMIN_MODULE_MAP)) {
    if (cleanPath.startsWith(routePrefix)) {
      return requiredPerm;
    }
  }
  return null;
}

/**
 * Valida permisos modulares para usuarios con rol ADMIN.
 * Implementa política estricta FAIL-CLOSED: si una ruta administrativa no está
 * mapeada explícitamente en ADMIN_MODULE_MAP, deniega el acceso por defecto (PR.AA-05).
 */
export function checkAdminModulePermissions(
  permissions: string[],
  rawUrl: string,
): void {
  const cleanPath = getPathWithoutQuery(rawUrl);
  if (!cleanPath.startsWith("/api/admin") && !cleanPath.startsWith("/admin")) {
    return;
  }

  const requiredPerm = resolveRequiredPermission(cleanPath);
  if (!requiredPerm) {
    throw new ForbiddenException(
      "Módulo administrativo no reconocido o sin política de acceso definida. Acceso denegado (Fail-Closed).",
    );
  }

  const hasPerm =
    permissions.includes(requiredPerm) ||
    (requiredPerm === "arpha" && permissions.includes("events"));

  if (!hasPerm) {
    throw new ForbiddenException(
      `No tienes permisos asignados para el módulo administrativo '${requiredPerm}'. Contacta a un Superadministrador.`,
    );
  }
}

/**
 * RolesGuard — Verifica que el usuario autenticado posea el rol y permisos requeridos.
 * Satisface NIST CSF 2.0 PR.AA-05 (Separación de Funciones y Menor Privilegio).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  private validateAdminAccess(
    adminPermissions: string[] | undefined,
    rawUrl: string,
  ): void {
    const perms = Array.isArray(adminPermissions) ? adminPermissions : [];
    if (!perms.includes("*")) {
      checkAdminModulePermissions(perms, rawUrl);
    }
  }

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
      throw new ForbiddenException("Acceso denegado: usuario no autenticado");
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

    if (userRole === Role.ADMIN) {
      this.validateAdminAccess(
        user.adminPermissions,
        request.originalUrl || request.url || "",
      );
    }

    return true;
  }
}
