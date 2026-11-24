import { createHmac } from "node:crypto";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import {
  BIRD_CHANNEL_NAME_REGEX,
  BIRD_CONNECTION_ID_REGEX,
} from "./bird-realtime.dto";

function assertSafeConnectionId(connectionId: string): void {
  if (!BIRD_CONNECTION_ID_REGEX.test(connectionId)) {
    throw new BadRequestException("connection_id inválido");
  }
}

function assertSafeChannelName(channelName: string): void {
  if (!BIRD_CHANNEL_NAME_REGEX.test(channelName)) {
    throw new ForbiddenException("channel_name inválido o no autorizado");
  }
}

/**
 * Derives a presence-safe display name that never broadcasts raw email PII.
 */
export function resolveSafeRealtimeDisplayName(
  name?: string | null,
  role = "user",
): string {
  const cleaned = (name ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 60);
  if (cleaned && !cleaned.includes("@")) {
    return cleaned;
  }
  return role === "admin" || role === "superadmin"
    ? "Staff BSK"
    : "Miembro BSK";
}

export function assertChannelAuthorized(
  channelName: string,
  betterAuthId: string,
  userId?: string,
  role = "user",
  adminPermissions: string[] = [],
  authPortal = "standard",
): void {
  const perms = Array.isArray(adminPermissions) ? adminPermissions : [];
  const hasConsolePortal =
    authPortal === "console" || authPortal === "superadmin";
  const hasStaffPortal = authPortal === "fascia" || hasConsolePortal;
  const hasAdminSupportPerm =
    hasStaffPortal &&
    (role === "superadmin" ||
      (role === "admin" &&
        (perms.includes("*") ||
          perms.includes("support") ||
          perms.includes("users"))));

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
    if (!isOwner && !hasAdminSupportPerm) {
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
    // M-12: Require explicit support/* permission and elevated portal session for admin realtime channels.
    const canJoinAdmin =
      hasConsolePortal &&
      (role === "superadmin" ||
        (role === "admin" &&
          (perms.includes("*") || perms.includes("support"))));
    if (!canJoinAdmin) {
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
  assertSafeConnectionId(connectionId);
  const safeName = resolveSafeRealtimeDisplayName(displayName, role);
  const memberData = JSON.stringify({
    member_id: memberId,
    member_info: { name: safeName, role },
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
  assertSafeConnectionId(connectionId);
  assertSafeChannelName(channelName);

  if (channelName.startsWith("presence-") && memberId) {
    const safeName = resolveSafeRealtimeDisplayName(displayName, role);
    const memberData = JSON.stringify({
      member_id: memberId,
      member_info: { name: safeName, role },
    });
    const toSign = `${connectionId}:${channelName}:${memberData}`;
    const sig = createHmac("sha256", secret).update(toSign).digest("hex");
    return { auth: `${key}:${sig}`, member_data: memberData };
  }

  const toSign = `${connectionId}:${channelName}`;
  const sig = createHmac("sha256", secret).update(toSign).digest("hex");
  return { auth: `${key}:${sig}` };
}
