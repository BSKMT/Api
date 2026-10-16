import { randomBytes } from "node:crypto";

export function generateCheckInCode(prefix: "EVT" | "CRS"): string {
  const part1 = randomBytes(2).toString("hex").toUpperCase();
  const part2 = randomBytes(2).toString("hex").toUpperCase();
  return `${prefix}-${part1}-${part2}`;
}

export function buildQrTicketPayload(
  type: "EVENT" | "COURSE",
  data: {
    registrationId: string;
    slug: string;
    checkInCode: string;
    userId: string;
  },
): string {
  return JSON.stringify({
    schema: "BSK_CHECKIN_V1",
    type: `BSK_${type}_TICKET`,
    regId: data.registrationId,
    code: data.checkInCode,
    slug: data.slug,
    uid: data.userId,
    ts: Date.now(),
  });
}

export function parseCheckInInput(input: string): {
  checkInCode: string;
  registrationId?: string;
  slug?: string;
} {
  const trimmed = input.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const code =
        typeof parsed.code === "string" ? parsed.code.trim().toUpperCase() : "";
      const regId =
        typeof parsed.regId === "string" ? parsed.regId.trim() : undefined;
      const slug =
        typeof parsed.slug === "string" ? parsed.slug.trim() : undefined;
      if (code || regId) {
        return { checkInCode: code, registrationId: regId, slug };
      }
    } catch {
      // not valid json, treat as plain code
    }
  }

  // Plain alphanumeric code or ObjectId string
  return { checkInCode: trimmed.toUpperCase() };
}
