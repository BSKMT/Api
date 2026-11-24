import {
  type ParsedBoldWebhookPayload,
  parseBoldAmount,
  parseBoldWebhookPayload,
  mapBoldWebhookStatus,
} from "../payments/bold.helpers";

export type ParsedMembershipWebhook = ParsedBoldWebhookPayload;

export { parseBoldAmount };

export function parseBoldWebhookEvent(
  event: Record<string, unknown>,
): ParsedMembershipWebhook {
  return parseBoldWebhookPayload(event);
}

export function mapBoldStatus(eventType: string | undefined): string | null {
  return mapBoldWebhookStatus(eventType);
}
