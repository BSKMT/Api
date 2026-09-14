import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  scryptSync,
} from "node:crypto";
import { Logger } from "@nestjs/common";

export function deriveSessionEncryptionKey(secret: string): Buffer {
  return scryptSync(secret, "session-cookies-v1", 32);
}

export function encryptSessionCookies(
  cookies: string[],
  sessionEncKey: Buffer,
): string {
  const plaintext = JSON.stringify(cookies);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sessionEncKey, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${ct.toString("hex")}`;
}

export function decryptSessionCookies(
  stored: string,
  sessionEncKey: Buffer,
  logger?: Logger,
): string[] {
  const parts = stored.split(":");
  if (parts.length !== 3) return [];
  try {
    const iv = Buffer.from(parts[0], "hex");
    const tag = Buffer.from(parts[1], "hex");
    const ct = Buffer.from(parts[2], "hex");
    const decipher = createDecipheriv("aes-256-gcm", sessionEncKey, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return JSON.parse(pt.toString("utf8")) as string[];
  } catch (err) {
    logger?.error(
      `Failed to decrypt session cookies (tamper or key mismatch): ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
}

export function extractCookiesFromHeaders(
  setCookieHeaders: string[],
): string[] {
  const cookies: string[] = [];
  for (const sc of setCookieHeaders) {
    const semi = sc.indexOf(";");
    const pair = (semi === -1 ? sc : sc.slice(0, semi)).trim();
    const eq = pair.indexOf("=");
    if (eq > 0) {
      cookies.push(pair);
    }
  }
  return cookies;
}
