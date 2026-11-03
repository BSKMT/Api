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
import { KvCacheService } from "../kv/kv-cache.service";

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

interface SessionUserCache {
  _id: string;
  role: string;
  subrol?: string | null;
  adminPermissions?: string[];
  isActive: boolean;
  accountDeletionRequested: boolean;
}

const ALLOWED_DURING_DELETION = new Set([
  "/api/settings/deletion-status",
  "/api/settings/cancel-deletion",
  "/api/settings/delete-account",
  "/api/auth/sign-out",
]);

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
    private readonly kvCache: KvCacheService,
  ) {}

  private async resolveMongooseUser(
    betterAuthUserId: string,
  ): Promise<SessionUserCache | null> {
    const cacheKey = `user:ba:${betterAuthUserId}`;
    const cached = await this.kvCache.get<SessionUserCache>(cacheKey, true);
    if (cached) {
      return cached;
    }

    const mongooseUser =
      await this.usersService.findByBetterAuthId(betterAuthUserId);
    if (!mongooseUser) {
      return null;
    }

    const userData: SessionUserCache = {
      _id: String(mongooseUser._id),
      role: mongooseUser.role,
      subrol: mongooseUser.subrol ?? null,
      adminPermissions: mongooseUser.adminPermissions ?? [],
      isActive: mongooseUser.isActive,
      accountDeletionRequested: mongooseUser.accountDeletionRequested ?? false,
    };

    await this.kvCache.set(cacheKey, userData, 120, true);
    return userData;
  }

  private assertAccountActiveAndNotDeleted(
    user: SessionUserCache,
    request: Request,
  ): void {
    if (user.isActive === false) {
      throw new UnauthorizedException(
        "Tu cuenta ha sido desactivada. Contacta al administrador.",
      );
    }
    if (user.accountDeletionRequested === true) {
      let rawPath = (request.originalUrl || request.url || "")
        .split("?")[0]
        .toLowerCase()
        .trim();
      while (rawPath.length > 1 && rawPath.endsWith("/")) {
        rawPath = rawPath.slice(0, -1);
      }
      if (!ALLOWED_DURING_DELETION.has(rawPath)) {
        throw new UnauthorizedException(
          "Tu cuenta está marcada para eliminación. Puedes consultar o cancelar la solicitud desde configuración.",
        );
      }
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    if (request.method === "OPTIONS") return true;

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

    if (session.session?.otpPending === true) {
      throw new UnauthorizedException(
        "No autorizado — verificación de segundo factor (OTP) pendiente",
      );
    }

    const mongooseUser = await this.resolveMongooseUser(session.user.id);
    if (!mongooseUser) {
      throw new UnauthorizedException(
        "Usuario no encontrado en la base de datos",
      );
    }

    this.assertAccountActiveAndNotDeleted(mongooseUser, request);

    (
      request as Request & {
        user: {
          userId: string;
          email: string;
          role: string;
          subrol?: string | null;
          adminPermissions?: string[];
          betterAuthId: string;
          sessionToken?: string;
          sessionId?: string;
        };
      }
    ).user = {
      userId: String(mongooseUser._id),
      email: session.user.email,
      role: mongooseUser.role,
      subrol: mongooseUser.subrol ?? null,
      adminPermissions: mongooseUser.adminPermissions ?? [],
      betterAuthId: session.user.id,
      sessionToken: session.session?.token,
      sessionId: session.session?.id,
    };

    return true;
  }
}
