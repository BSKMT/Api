import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { getAuth } from "./better-auth";
import { UsersService } from "../users/users.service";
import { IS_PUBLIC_KEY } from "../common/decorators/public.decorator";

/**
 * SessionGuard — replaces the old JwtAuthGuard.
 *
 * On every request it calls `auth.api.getSession()` with the raw request
 * headers (which include the Better Auth session cookie). If a valid session
 * is found, the Mongoose user is retrieved by `betterAuthId` and `req.user`
 * is populated with `{ userId, email, role }` so all downstream controllers
 * and services continue to work without changes.
 *
 * Routes decorated with `@Public()` are skipped.
 */
@Injectable()
export class SessionGuard {
  constructor(
    private readonly reflector: Reflector,
    private readonly usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();

    const auth = await getAuth();
    const session = await auth.api.getSession({
      headers: new Headers(
        Object.entries(request.headers as Record<string, string>),
      ),
    });

    if (!session) {
      throw new UnauthorizedException(
        "No autorizado — sesión no encontrada o expirada",
      );
    }

    const betterAuthUserId = session.user.id;

    const mongooseUser =
      await this.usersService.findByBetterAuthId(betterAuthUserId);

    if (!mongooseUser) {
      throw new UnauthorizedException(
        "Usuario no encontrado en la base de datos",
      );
    }

    (
      request as Request & {
        user: { userId: string; email: string; role: string };
      }
    ).user = {
      userId: String(mongooseUser._id),
      email: session.user.email,
      role: mongooseUser.role,
    };

    return true;
  }
}
