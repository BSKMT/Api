import { BadRequestException, Logger } from "@nestjs/common";
import { ObjectId } from "mongodb";
import { getMongoDb } from "../auth/better-auth";
import { parseUserAgent } from "./settings-ua.helpers";
import type { SessionRow } from "./settings.constants";

export function buildUserFilter(betterAuthId: string, userId?: string) {
  const ids: (string | ObjectId)[] = [];
  if (betterAuthId) {
    ids.push(betterAuthId);
    if (ObjectId.isValid(betterAuthId)) {
      ids.push(new ObjectId(betterAuthId));
    }
  }
  if (userId && userId !== betterAuthId) {
    ids.push(userId);
    if (ObjectId.isValid(userId)) {
      ids.push(new ObjectId(userId));
    }
  }
  return { userId: { $in: ids } };
}

export async function executeGetSessions(
  userId: string,
  betterAuthId: string,
  currentToken: string,
  logger: Logger,
) {
  const db = getMongoDb();
  const query = buildUserFilter(betterAuthId, userId);
  const sessions = (await db
    .collection("session")
    .find(query)
    .sort({ createdAt: -1 })
    .toArray()) as unknown as (SessionRow & { _id?: ObjectId })[];

  logger.log(
    `getSessions: userId=${userId} betterAuthId=${betterAuthId.substring(0, 10)}... found=${sessions.length} sessions`,
  );

  const cleanCurrentToken = currentToken ? currentToken.split(".")[0] : "";

  return sessions.map((s) => {
    const ua = parseUserAgent(s.userAgent);
    const sid = s._id ? s._id.toString() : String(s.id ?? "");
    const isCurrentSession = Boolean(
      cleanCurrentToken && s.token && s.token === cleanCurrentToken,
    );
    const isActiveSession = s.expiresAt
      ? new Date(s.expiresAt).getTime() > Date.now()
      : true;

    const rawUid = s.userId ?? betterAuthId;
    const uid = typeof rawUid === "string" ? rawUid : rawUid.toString();

    return {
      id: sid,
      userId: uid,
      browser: ua.browser,
      os: ua.os,
      device: ua.device,
      userAgent: s.userAgent ?? `${ua.device} - ${ua.browser}`,
      ipAddress: s.ipAddress ?? "—",
      isCurrent: isCurrentSession,
      isActive: isActiveSession,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      lastActive: s.updatedAt ?? s.createdAt,
    };
  });
}

export async function executeRevokeSession(
  sessionId: string,
  betterAuthId: string,
  logger: Logger,
) {
  if (!sessionId || typeof sessionId !== "string") {
    throw new BadRequestException("ID de sesión inválido");
  }

  const db = getMongoDb();
  const idFilters: Record<string, unknown>[] = [{ id: sessionId }];
  if (ObjectId.isValid(sessionId)) {
    idFilters.push({ _id: new ObjectId(sessionId) });
  } else {
    idFilters.push({ _id: sessionId });
  }

  const userQuery = buildUserFilter(betterAuthId);

  const result = await db.collection("session").deleteOne({
    $or: idFilters,
    ...userQuery,
  });

  if (result.deletedCount === 0) {
    throw new BadRequestException("Sesión no encontrada");
  }
  logger.log(`Session revoked: id=${sessionId.substring(0, 10)}...`);
  return { success: true };
}

export async function executeRevokeAllOtherSessions(
  betterAuthId: string,
  currentToken: string,
  logger: Logger,
) {
  const db = getMongoDb();
  const userQuery = buildUserFilter(betterAuthId);
  const cleanCurrentToken = currentToken ? currentToken.split(".")[0] : "";

  const filter: Record<string, unknown> = {
    ...userQuery,
  };
  if (cleanCurrentToken) {
    filter["token"] = { $ne: cleanCurrentToken };
  }

  const result = await db.collection("session").deleteMany(filter);
  logger.log(
    `Revoked ${result.deletedCount} other sessions for user ${betterAuthId.substring(0, 10)}...`,
  );
  return { revoked: result.deletedCount };
}
