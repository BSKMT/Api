import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { getAuth } from "./better-auth";
import type { AuthInstance, BetterAuthSessionData } from "./better-auth";
import { UsersService } from "../users/users.service";
import { IS_PUBLIC_KEY } from "../common/decorators/public.decorator";

/**
 * `better-auth/node` is published as an ES Module (`.mjs`). The project
 * is compiled to CommonJS, so a top-level `import` would compile to
 * `require()` and throw `ERR_REQUIRE_ESM` at runtime. We lazily load the
 * `fromNodeHeaders` function via a cached dynamic `import()` so the
 * dynamic import only fires once per cold start.
 */
type FromNodeHeadersFn = (headers: unknown) => Headers;
interface BetterAuthNodeModule {
  fromNodeHeaders: FromNodeHeadersFn;
}

let fromNodeHeadersPromise: Promise<FromNodeHeadersFn> | null = null;

async function loadFromNodeHeaders(): Promise<FromNodeHeadersFn> {
  fromNodeHeadersPromise ??= (async (): Promise<FromNodeHeadersFn> => {
    const mod = (await import("better-auth/node")) as BetterAuthNodeModule;
    const fn: unknown = mod.fromNodeHeaders;
    return fn as FromNodeHeadersFn;
  })();
  return fromNodeHeadersPromise;
}

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
    const fromNodeHeaders = await loadFromNodeHeaders();
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
        user: {
          userId: string;
          email: string;
          role: string;
          betterAuthId: string;
        };
      }
    ).user = {
      userId: String(mongooseUser._id),
      email: session.user.email,
      role: mongooseUser.role,
      betterAuthId: session.user.id,
    };

    return true;
  }
}
