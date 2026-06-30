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

    const request = context.switchToHttp().getRequest<
      Request & { user?: { userId: string; role?: string } }
    >();

    if (!request.user?.userId) {
      throw new ForbiddenException("Acceso denegado");
    }

    const userRole = request.user.role as Role;

    if (!userRole || !requiredRoles.includes(userRole)) {
      throw new ForbiddenException(
        "No tienes permisos para realizar esta acción",
      );
    }

    return true;
  }
}