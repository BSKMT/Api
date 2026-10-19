import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const TOKEN_PREFIX = "bsk_sec_";
const QR_PROTOCOL_PREFIX = "BSKMT_SECURE_QR:v1:";

function getProfileKey(): Buffer {
  const secret =
    process.env.PROFILE_TOKEN_SECRET || process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "BETTER_AUTH_SECRET o PROFILE_TOKEN_SECRET (>=32 chars) es requerido en producción",
      );
    }
  }
  const effectiveSecret =
    secret || "bskmt-default-secure-profile-encryption-key-32chars";
  return createHash("sha256")
    .update(`${effectiveSecret}:bskmt-profile-token-v1`)
    .digest();
}

/**
 * Encrypts a member identifier into a tamper-proof, non-enumerable, URL-safe token.
 * Uses AES-256-GCM with a unique 12-byte random IV per encryption call,
 * preventing AES-GCM nonce reuse attacks while keeping tokens authenticated.
 */
export function serializeProfileIdentifier(
  memberNumber: string,
  userId?: string,
): string {
  if (!memberNumber) return "";
  const key = getProfileKey();
  const cleanMemberNumber = memberNumber.trim().toUpperCase();
  const payload = JSON.stringify({
    m: cleanMemberNumber,
    u: userId ? String(userId) : undefined,
    t: Date.now(),
  });

  const iv = randomBytes(12);

  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(payload, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // Combine IV (12) + AuthTag (16) + Ciphertext
  const tokenBuffer = Buffer.concat([iv, authTag, ciphertext]);
  return `${TOKEN_PREFIX}${tokenBuffer.toString("base64url")}`;
}

/**
 * Decrypts and verifies a serialized profile token.
 * Returns null if the token is tampered, altered, or invalid.
 */
export function deserializeProfileIdentifier(
  rawIdentifier: string,
): { memberNumber: string; userId?: string } | null {
  if (!rawIdentifier) return null;

  let token = rawIdentifier.trim();
  // Strip QR protocol prefix if present
  if (token.startsWith(QR_PROTOCOL_PREFIX)) {
    token = token.slice(QR_PROTOCOL_PREFIX.length).trim();
  }

  if (!token.startsWith(TOKEN_PREFIX)) {
    return null;
  }

  const base64UrlData = token.slice(TOKEN_PREFIX.length);
  try {
    const buffer = Buffer.from(base64UrlData, "base64url");
    if (buffer.length < 29) {
      // 12 (IV) + 16 (AuthTag) + at least 1 byte ciphertext
      return null;
    }

    const iv = buffer.subarray(0, 12);
    const authTag = buffer.subarray(12, 28);
    const ciphertext = buffer.subarray(28);

    const key = getProfileKey();
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");

    const parsed = JSON.parse(decrypted) as {
      m?: string;
      u?: string;
    };

    if (!parsed.m || typeof parsed.m !== "string") {
      return null;
    }

    return {
      memberNumber: parsed.m.trim().toUpperCase(),
      userId: parsed.u,
    };
  } catch {
    // Decryption failure, tampered tag, or corrupted base64
    return null;
  }
}

/**
 * Encodes payload for the physical/screen QR code.
 * Strictly formatted as a proprietary protocol scheme so generic scanners
 * (like Google Lens or smartphone default camera apps) cannot interpret it as a URL.
 */
export function buildSecureQrPayload(serializedToken: string): string {
  const cleanToken = serializedToken.trim();
  return `${QR_PROTOCOL_PREFIX}${cleanToken}`;
}

export function isSerializedProfileToken(identifier: string): boolean {
  if (!identifier) return false;
  const clean = identifier.trim();
  return clean.startsWith(TOKEN_PREFIX) || clean.startsWith(QR_PROTOCOL_PREFIX);
}
