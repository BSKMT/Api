import { createHmac } from "node:crypto";
import { ForbiddenException } from "@nestjs/common";

export function assertChannelAuthorized(
  channelName: string,
  betterAuthId: string,
  userId?: string,
  role = "user",
): void {
  if (
    channelName.startsWith("private-user-") ||
    channelName.startsWith("presence-user-")
  ) {
    const channelOwner = channelName.startsWith("private-user-")
      ? channelName.slice("private-user-".length)
      : channelName.slice("presence-user-".length);
    const isOwner =
      channelOwner === betterAuthId ||
      (Boolean(userId) && channelOwner === userId);
    if (!isOwner && role !== "admin" && role !== "superadmin") {
      throw new ForbiddenException(
        "No tienes autorización para unirte a este canal personal de usuario",
      );
    }
    return;
  }

  if (
    channelName.startsWith("private-admin") ||
    channelName.startsWith("presence-admin")
  ) {
    if (role !== "admin" && role !== "superadmin") {
      throw new ForbiddenException(
        "Acceso denegado a canales de administración",
      );
    }
    return;
  }

  if (
    channelName.startsWith("presence-event-") ||
    channelName === "presence-community" ||
    channelName === "presence-chat"
  ) {
    return;
  }

  throw new ForbiddenException(
    `Canal no reconocido o no autorizado para suscripción: ${channelName}`,
  );
}

export function signMemberAuth(
  key: string,
  secret: string,
  connectionId: string,
  memberId: string,
  role = "user",
  displayName = "",
): { auth: string; member_data: string } {
  const memberData = JSON.stringify({
    member_id: memberId,
    member_info: { name: displayName, role },
  });

  const toSign = `${connectionId}::member::${memberData}`;
  const sig = createHmac("sha256", secret).update(toSign).digest("hex");

  return { auth: `${key}:${sig}`, member_data: memberData };
}

export function signChannelAuth(
  key: string,
  secret: string,
  connectionId: string,
  channelName: string,
  memberId?: string,
  role = "user",
  displayName = "",
): { auth: string; member_data?: string } {
  if (channelName.startsWith("presence-") && memberId) {
    const memberData = JSON.stringify({
      member_id: memberId,
      member_info: { name: displayName, role },
    });
    const toSign = `${connectionId}:${channelName}:${memberData}`;
    const sig = createHmac("sha256", secret).update(toSign).digest("hex");
    return { auth: `${key}:${sig}`, member_data: memberData };
  }

  const toSign = `${connectionId}:${channelName}`;
  const sig = createHmac("sha256", secret).update(toSign).digest("hex");
  return { auth: `${key}:${sig}` };
}
