import { BadRequestException, Logger } from "@nestjs/common";
import type { Request } from "express";
import { getAuth, getMongoDb } from "../auth/better-auth";
import type { UserDocument } from "../users/schemas/user.schema";

export function extractSessionTokenFromCookie(cookieHeader: string): string {
  const cookies = cookieHeader.split(";").map((c) => c.trim());
  for (const cookie of cookies) {
    const eq = cookie.indexOf("=");
    if (eq <= 0) continue;
    const name = cookie.slice(0, eq).trim();
    const value = cookie.slice(eq + 1).trim();
    if (
      name === "better-auth.session_token" ||
      name === "__Secure-better-auth.session_token"
    ) {
      return value;
    }
  }
  return "";
}

export async function discardOrphanSessionFromAuthResponse(
  authResponse: Response,
  user: UserDocument,
  logger?: Logger,
): Promise<void> {
  try {
    const setCookies = authResponse.headers.getSetCookie?.() ?? [];
    for (const sc of setCookies) {
      const semi = sc.indexOf(";");
      const pair = (semi === -1 ? sc : sc.slice(0, semi)).trim();
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (
        name === "better-auth.session_token" ||
        name === "__Secure-better-auth.session_token"
      ) {
        const db = getMongoDb();
        await db
          .collection("session")
          .deleteOne({ userId: user.betterAuthId, token: value });
        logger?.log(
          `Discarded orphan session after re-auth for user ${user.betterAuthId}`,
        );
      }
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
  const auth = await getAuth();
  try {
    await auth.api.changePassword({
      body: { currentPassword, newPassword },
      headers: req.headers,
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

  const typedReq = req as Request & {
    user?: { userId?: string; betterAuthId?: string };
  };
  const betterAuthId = typedReq.user?.betterAuthId;
  const cookieHeader = req.headers.cookie ?? "";
  const currentToken = extractSessionTokenFromCookie(cookieHeader);
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
