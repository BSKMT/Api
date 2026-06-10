import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { ROLES_KEY, Role } from "../decorators/roles.decorator";
import { UsersService } from "../../users/users.service";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const user = (
      request as Request & { user?: { userId: string; role?: string } }
    ).user;

    if (!user?.userId) {
      throw new ForbiddenException("Acceso denegado");
    }

    if (user.role && requiredRoles.includes(user.role as Role)) {
      return true;
    }

    const fullUser = await this.usersService.findById(user.userId);
    if (!fullUser) {
      throw new ForbiddenException("Usuario no encontrado");
    }

    const userRole = fullUser.role as Role;
    if (!requiredRoles.includes(userRole)) {
      throw new ForbiddenException(
        "No tienes permisos para realizar esta accion",
      );
    }

    (request as Request & { user: { userId: string; role: string } }).user = {
      ...user,
      role: userRole,
    };
    return true;
  }
}
