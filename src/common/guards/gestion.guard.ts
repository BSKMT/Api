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
  };
}

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

    if (!request.user?.userId) {
      throw new ForbiddenException("Acceso denegado — sesión no autenticada");
    }

    // Role 'admin' has complete, unrestricted access to everything
    if (request.user.role === UserRole.ADMIN) {
      return true;
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
