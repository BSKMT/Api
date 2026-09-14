import { createHmac } from "node:crypto";
import { Logger } from "@nestjs/common";
import type { BirdWebhookEvent } from "./bird.service";

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

export function processBirdWebhookEvent(
  logger: Logger,
  event: BirdWebhookEvent,
): void {
  logger.debug(
    `processWebhookEvent: type=${event.type}, data=${JSON.stringify(event.data).slice(0, 200)}`,
  );

  const memberId =
    typeof event.data.member_id === "string" ? event.data.member_id : "";
  const channel =
    typeof event.data.channel === "string" ? event.data.channel : "";

  switch (event.type) {
    case "realtime.member_added":
      logger.log(
        `realtime.member_added: member=${memberId}, channel=${channel}`,
      );
      break;
    case "realtime.member_removed":
      logger.log(
        `realtime.member_removed: member=${memberId}, channel=${channel}`,
      );
      break;
    case "realtime.channel_occupied":
      logger.debug(`realtime.channel_occupied: channel=${channel}`);
      break;
    case "realtime.channel_vacated":
      logger.debug(`realtime.channel_vacated: channel=${channel}`);
      break;
    default:
      logger.debug(`Unhandled webhook type: ${event.type}`);
      break;
  }
}
