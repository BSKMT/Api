import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  scryptSync,
} from "node:crypto";
import { Logger } from "@nestjs/common";

const logger = new Logger("FieldEncryptionHelper");
const ENVELOPE_PREFIX = "enc:v1:";
const SALT = "bskmt-field-encryption-v1";

/**
 * Derives a 256-bit symmetric key using scrypt from the provided secret
 * or from environment variables (FIELD_ENCRYPTION_KEY / BETTER_AUTH_SECRET).
 * NIST CSF 2.0: PR.DS-01, PR.DS-02.
 */
export function deriveFieldEncryptionKey(secret?: string): Buffer {
  const masterSecret =
    secret ||
    process.env.FIELD_ENCRYPTION_KEY ||
    process.env.BETTER_AUTH_SECRET;
  if (!masterSecret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "FIELD_ENCRYPTION_KEY or BETTER_AUTH_SECRET is required in production",
      );
    }
    return scryptSync(`dev-test-only-${process.pid}`, SALT, 32);
  }
  return scryptSync(masterSecret, SALT, 32);
}

/**
 * Determines whether a given value is already encrypted with the envelope format enc:v1:...
 */
export function isEncryptedField(value: unknown): boolean {
  return typeof value === "string" && value.startsWith(ENVELOPE_PREFIX);
}

/**
 * Encrypts a sensitive JavaScript object or string using AES-256-GCM.
 * Protects health, PII, and legal documents at rest (NIST PR.DS-01, Ley 1581 de 2012).
 *
 * @param data The payload to encrypt.
 * @param key Optional pre-derived 32-byte key.
 * @returns The envelope string `enc:v1:<iv-hex>:<tag-hex>:<ciphertext-hex>`.
 */
export function encryptSensitiveField(
  data: unknown,
  key?: Buffer,
): string | null | undefined {
  if (data === null) {
    return null;
  }
  if (data === undefined) {
    return undefined;
  }

  // Idempotency: if already encrypted, do not re-encrypt
  if (isEncryptedField(data)) {
    return data as string;
  }

  try {
    const encKey = key || deriveFieldEncryptionKey();
    const plaintext = typeof data === "string" ? data : JSON.stringify(data);
    const iv = randomBytes(12); // NIST SP 800-38D recommended 96-bit IV
    const cipher = createCipheriv("aes-256-gcm", encKey, iv);

    const ct = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return `${ENVELOPE_PREFIX}${iv.toString("hex")}:${tag.toString("hex")}:${ct.toString("hex")}`;
  } catch (err) {
    logger.error(
      `Error al cifrar campo sensible: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  }
}

/**
 * Decrypts an AES-256-GCM encrypted field envelope.
 * If the value is not encrypted (e.g. legacy plaintext from existing database records),
 * it returns the value untouched for 100% backward compatibility.
 *
 * @param stored The stored value (either encrypted string or plain object).
 * @param key Optional pre-derived 32-byte key.
 */
export function decryptSensitiveField<T = unknown>(
  stored: unknown,
  key?: Buffer,
): T {
  if (stored === null || stored === undefined) {
    return stored as T;
  }

  if (!isEncryptedField(stored)) {
    // Legacy plaintext: return as-is
    return stored as T;
  }

  try {
    const raw = (stored as string).slice(ENVELOPE_PREFIX.length);
    const parts = raw.split(":");
    if (parts.length !== 3) {
      logger.warn("Formato de sobre cifrado inválido; omitiendo descifrado.");
      return stored as T;
    }

    const [ivHex, tagHex, ctHex] = parts;
    const iv = Buffer.from(ivHex, "hex");
    const tag = Buffer.from(tagHex, "hex");
    const ct = Buffer.from(ctHex, "hex");

    const encKey = key || deriveFieldEncryptionKey();
    const decipher = createDecipheriv("aes-256-gcm", encKey, iv);
    decipher.setAuthTag(tag);

    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    const plaintext = pt.toString("utf8");

    try {
      return JSON.parse(plaintext) as T;
    } catch {
      return plaintext as unknown as T;
    }
  } catch (err) {
    logger.error(
      `Fallo de autenticación o integridad al descifrar campo sensible (posible manipulación): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    // Fail-safe: return empty object instead of crashing
    return {} as T;
  }
}

/**
 * Encrypts sensitive sections of a user profile (salud-seguridad, documentacion-legal)
 * prior to persisting to MongoDB.
 */
export function encryptUserProfileSensitiveFields(
  profile: unknown,
  key?: Buffer,
): void {
  if (!profile || typeof profile !== "object") return;
  const p = profile as Record<string, unknown>;

  const encKey = key || deriveFieldEncryptionKey();

  if (p["salud-seguridad"]) {
    p["salud-seguridad"] = encryptSensitiveField(p["salud-seguridad"], encKey);
  }

  if (p["documentacion-legal"]) {
    p["documentacion-legal"] = encryptSensitiveField(
      p["documentacion-legal"],
      encKey,
    );
  }
}

/**
 * Decrypts sensitive sections of a user profile upon hydration or retrieval.
 */
export function decryptUserProfileSensitiveFields(
  profile: unknown,
  key?: Buffer,
): void {
  if (!profile || typeof profile !== "object") return;
  const p = profile as Record<string, unknown>;

  const encKey = key || deriveFieldEncryptionKey();

  if (p["salud-seguridad"]) {
    p["salud-seguridad"] = decryptSensitiveField(p["salud-seguridad"], encKey);
  }

  if (p["documentacion-legal"]) {
    p["documentacion-legal"] = decryptSensitiveField(
      p["documentacion-legal"],
      encKey,
    );
  }
}
