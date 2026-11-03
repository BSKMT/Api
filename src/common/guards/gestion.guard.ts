import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { SUBROLES_KEY } from "../decorators/subroles.decorator";
import { UserRole, UserSubrole } from "../../users/schemas/user.schema";

interface AuthenticatedGestionRequest extends Request {
  user?: {
    userId: string;
    email?: string;
    role?: string;
    subrol?: string | null;
    adminPermissions?: string[];
  };
}

const SUBROLE_TO_ADMIN_MODULE: Record<string, string> = {
  [UserSubrole.LIDER_CURSOS]: "courses",
  [UserSubrole.GESTOR_CURSOS]: "courses",
  [UserSubrole.LIDER_EVENTOS]: "events",
  [UserSubrole.GESTOR_EVENTOS]: "events",
  [UserSubrole.LIDER_TIENDA]: "store",
  [UserSubrole.GESTOR_TIENDA]: "store",
  [UserSubrole.LIDER_ARPHA]: "arpha",
  [UserSubrole.GESTOR_CAMPO_ARPHA]: "arpha",
  [UserSubrole.GESTOR_MESA_ARPHA]: "arpha",
  [UserSubrole.LIDER_MEMBRESIAS]: "membership",
  [UserSubrole.GESTOR_MEMBRESIAS]: "membership",
  [UserSubrole.LIDER_ATENCION_MIEMBRO]: "support",
  [UserSubrole.GESTOR_ATENCION_MIEMBRO]: "support",
  [UserSubrole.LIDER_COMUNIDAD]: "support",
};

@Injectable()
export class GestionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredSubroles = this.reflector.getAllAndOverride<
      (UserSubrole | string)[]
    >(SUBROLES_KEY, [context.getHandler(), context.getClass()]);

    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedGestionRequest>();

    if (request.method === "OPTIONS") {
      return true;
    }

    if (!request.user?.userId) {
      throw new ForbiddenException("Acceso denegado — sesión no autenticada");
    }

    // Role 'superadmin' has unconditional complete access
    if (request.user.role === UserRole.SUPERADMIN) {
      return true;
    }

    // Role 'admin' has access if unrestricted or if permission matches required module
    if (request.user.role === UserRole.ADMIN) {
      const adminPerms = request.user.adminPermissions;
      if (!Array.isArray(adminPerms) || adminPerms.includes("*")) {
        return true;
      }
      if (!requiredSubroles || requiredSubroles.length === 0) {
        return true;
      }
      const hasPerm = requiredSubroles.some((reqSub) => {
        const mod = SUBROLE_TO_ADMIN_MODULE[reqSub];
        return mod ? adminPerms.includes(mod) : false;
      });
      if (hasPerm) {
        return true;
      }
      throw new ForbiddenException(
        "Acceso denegado: tu rol de administrador no posee permisos para este módulo de gestión",
      );
    }

    const userSubrole = request.user.subrol;

    // If no specific subroles were tagged, any user with a subrole can access
    if (!requiredSubroles || requiredSubroles.length === 0) {
      if (userSubrole) {
        return true;
      }
      throw new ForbiddenException(
        "Acceso denegado: se requiere un subrol operativo de colaborador",
      );
    }

    // Check if the user's subrole matches any required subrole
    if (!userSubrole || !requiredSubroles.includes(userSubrole)) {
      throw new ForbiddenException(
        "Acceso denegado: no tienes permisos para este módulo de gestión",
      );
    }

    return true;
  }
}
