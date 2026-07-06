import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { fromNodeHeaders as _fromNodeHeaders } from "better-auth/node";
import { getAuth } from "./better-auth";
import type { AuthInstance, BetterAuthSessionData } from "./better-auth";
import { UsersService } from "../users/users.service";
import { IS_PUBLIC_KEY } from "../common/decorators/public.decorator";

/**
 * `fromNodeHeaders` is re-typed so the call site has a concrete signature
 * even when the editor's TypeScript server cannot resolve the deep generic
 * types exported by `better-auth/node`. The IIFE hides the assertion
 * inside an arrow function whose parameter is `unknown`, making the cast
 * necessary for both resolved and unresolved type environments.
 */
type FromNodeHeadersFn = (headers: unknown) => Headers;
const fromNodeHeaders: FromNodeHeadersFn = ((fn: unknown): FromNodeHeadersFn =>
  fn as FromNodeHeadersFn)(_fromNodeHeaders);

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

    const auth: AuthInstance = await getAuth();
    const session: BetterAuthSessionData | null = await auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
    });

    if (!session) {
      throw new UnauthorizedException(
        "No autorizado — sesión no encontrada o expirada",
      );
    }

    const betterAuthUserId: string = session.user.id;

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
