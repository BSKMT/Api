export interface ParsedMembershipWebhook {
  notificationId: string | undefined;
  eventType: string | undefined;
  paymentId: string | undefined;
  referenceId: string | undefined;
  paymentMethod: string | undefined;
  payerEmail: string | undefined;
  amount: number | undefined;
}

export function parseBoldAmount(raw: unknown): number | undefined {
  if (typeof raw === "number") return raw;
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const total = obj["total"];
    if (typeof total === "number") return total;
    const amount = obj["amount"];
    if (typeof amount === "number") return amount;
  }
  return undefined;
}

export function parseBoldWebhookEvent(
  event: Record<string, unknown>,
): ParsedMembershipWebhook {
  const notificationId = event["id"] as string | undefined;
  const eventType = event["type"] as string | undefined;
  const data = (event["data"] ?? {}) as Record<string, unknown>;
  const metadata = (data["metadata"] ?? {}) as Record<string, unknown>;
  return {
    notificationId,
    eventType,
    paymentId: data["payment_id"] as string | undefined,
    referenceId: metadata["reference"] as string | undefined,
    paymentMethod: data["payment_method"] as string | undefined,
    payerEmail: data["payer_email"] as string | undefined,
    amount: parseBoldAmount(data["amount"]),
  };
}
