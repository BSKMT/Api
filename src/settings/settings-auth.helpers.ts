import { BadRequestException, Logger } from "@nestjs/common";
import type { Request } from "express";
import { getAuth, getMongoDb } from "../auth/better-auth";
import type { UserDocument } from "../users/schemas/user.schema";
import {
  extractAllSessionTokensFromSetCookies,
  extractSessionTokenFromCookieHeader,
} from "../auth/better-auth-cookie.helper";
import { ObjectId } from "mongodb";

type FromNodeHeadersFn = (headers: unknown) => Headers;
interface BetterAuthNodeModule {
  fromNodeHeaders: FromNodeHeadersFn;
}

let fromNodeHeadersPromise: Promise<FromNodeHeadersFn> | null = null;

async function loadFromNodeHeaders(): Promise<FromNodeHeadersFn> {
  fromNodeHeadersPromise ??= (async (): Promise<FromNodeHeadersFn> => {
    const mod = (await import("better-auth/node")) as BetterAuthNodeModule;
    return mod.fromNodeHeaders;
  })();
  return fromNodeHeadersPromise;
}

export function extractSessionTokenFromCookie(cookieHeader: string): string {
  return extractSessionTokenFromCookieHeader(cookieHeader) ?? "";
}

/**
 * Verifica la contraseña del usuario directamente contra el hash scrypt almacenado
 * por Better Auth en la colección `account` (sin crear sesiones huérfanas ni
 * disparar hooks de sesión, y compatible con cuentas con 2FA habilitado).
 */
export async function verifyUserPasswordWithBetterAuth(
  betterAuthId: string | undefined,
  password: string,
): Promise<boolean> {
  if (!betterAuthId || !password) return false;
  const userFilters: (string | ObjectId)[] = [betterAuthId];
  if (ObjectId.isValid(betterAuthId)) {
    userFilters.push(new ObjectId(betterAuthId));
  }
  const db = getMongoDb();
  const credentialAccount = await db.collection("account").findOne(
    {
      providerId: "credential",
      userId: { $in: userFilters },
    },
    { projection: { password: 1 } },
  );
  const hash =
    typeof credentialAccount?.["password"] === "string"
      ? credentialAccount["password"]
      : "";
  if (!hash) return false;
  const auth = await getAuth();
  const ctx = await auth.$context;
  return ctx.password.verify({ hash, password });
}

export async function discardOrphanSessionFromAuthResponse(
  authResponse: Response,
  user: UserDocument,
  logger?: Logger,
): Promise<void> {
  try {
    const setCookies = authResponse.headers.getSetCookie?.() ?? [];
    const tokensToDelete = extractAllSessionTokensFromSetCookies(setCookies);

    if (tokensToDelete.length > 0) {
      const userFilters: (string | ObjectId)[] = [user.betterAuthId];
      if (ObjectId.isValid(user.betterAuthId)) {
        userFilters.push(new ObjectId(user.betterAuthId));
      }
      const db = getMongoDb();
      await db.collection("session").deleteMany({
        userId: { $in: userFilters },
        token: { $in: tokensToDelete },
      });
      logger?.log(
        `Discarded orphan session after re-auth for user ${user.betterAuthId}`,
      );
    }
  } catch (err: unknown) {
    logger?.warn(
      `discardOrphanSessionFromAuthResponse failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

export async function handlePasswordChange(
  req: Request,
  currentPassword: string,
  newPassword: string,
  revokeOtherSessionsFn: (
    betterAuthId: string,
    currentToken: string,
  ) => Promise<unknown>,
  logger: Logger,
) {
  if (newPassword === currentPassword) {
    throw new BadRequestException(
      "La nueva contraseña debe ser diferente a la actual",
    );
  }
  const [auth, fromNodeHeaders] = await Promise.all([
    getAuth(),
    loadFromNodeHeaders(),
  ]);
  try {
    await auth.api.changePassword({
      body: {
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      },
      headers: fromNodeHeaders(req.headers),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    if (/password/i.test(msg)) {
      throw new BadRequestException(
        "No se pudo cambiar la contraseña. Verifica que la contraseña actual sea correcta.",
      );
    }
    throw new BadRequestException(
      "No se pudo cambiar la contraseña. Inténtalo de nuevo.",
    );
  }

  // Defensa en profundidad: asegurar que no queden sesiones residuales fuera de la actual
  const typedReq = req as Request & {
    user?: { userId?: string; betterAuthId?: string; sessionToken?: string };
  };
  const betterAuthId = typedReq.user?.betterAuthId;
  const cookieHeader = req.headers.cookie ?? "";
  const currentToken =
    extractSessionTokenFromCookie(cookieHeader) ||
    typedReq.user?.sessionToken ||
    "";
  if (betterAuthId && currentToken) {
    try {
      await revokeOtherSessionsFn(betterAuthId, currentToken);
    } catch (err: unknown) {
      logger.warn(
        `Failed to revoke other sessions after password change: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  return { success: true, message: "Contraseña actualizada correctamente" };
}
