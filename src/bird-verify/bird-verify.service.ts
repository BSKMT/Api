import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { BirdService } from "../bird/bird.service";
import type {
  BirdVerificationStatus,
  BirdVerifyCreateParams,
  BirdVerifyCheckParams,
  BirdVerificationResponse,
  BirdVerificationCheckResult,
} from "../bird/bird.service";

const E164_PATTERN = /^\+[1-9]\d{5,14}$/;
const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const OTP_CODE_PATTERN = /^\d{4,10}$/;
const ALLOWED_VERIFY_CHANNELS = new Set(["whatsapp", "sms", "email", "voice"]);

function normalizeVerifyEmail(email: string): string {
  const normalized = (email ?? "").trim().toLowerCase();
  if (
    !normalized ||
    normalized.length > 254 ||
    /[\r\n\0]/.test(normalized) ||
    !EMAIL_PATTERN.test(normalized)
  ) {
    throw new BadRequestException(
      "Correo electrónico inválido para verificación.",
    );
  }
  return normalized;
}

function normalizeOtpCode(code: string): string {
  const normalized = (code ?? "").trim();
  if (!OTP_CODE_PATTERN.test(normalized)) {
    throw new BadRequestException(
      "El código de verificación debe ser numérico.",
    );
  }
  return normalized;
}

function sanitizeVerifyChannels(channels?: string[]): string[] {
  if (!Array.isArray(channels) || channels.length === 0) {
    return ["whatsapp"];
  }
  const filtered = channels
    .map((c) => c.trim().toLowerCase())
    .filter((c) => ALLOWED_VERIFY_CHANNELS.has(c));
  return filtered.length > 0 ? filtered : ["whatsapp"];
}

function isAllowedVerifyPhonePrefix(phone: string): boolean {
  const raw = process.env.ALLOWED_SMS_PREFIXES ?? "+57";
  const prefixes = raw
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.startsWith("+"));
  const activePrefixes = prefixes.length > 0 ? prefixes : ["+57"];
  return (
    E164_PATTERN.test(phone) &&
    activePrefixes.some((prefix) => phone.startsWith(prefix))
  );
}

/**
 * BirdVerifyService — Wrapper around Bird Verify for sending and
 * verifying one-time passcodes (OTP) via email and SMS.
 *
 * Bird Verify confirms that someone controls an email address or phone
 * number: the API generates the code, delivers it, stores only a hash,
 * and enforces expiry + attempt limits. The app never sees or stores
 * the code in plaintext.
 *
 * Uses the shared `BirdService` (BirdClient SDK) so email, SMS, and
 * verify share a single instance.
 *
 * Security (OWASP A07:2025, A04:2025, A06:2025):
 *  - Bird stores only a hash of the code.
 *  - Bird enforces expiry (default 10 min) and max-retries (default 5).
 *  - Bird applies caps: 5 sends/recipient/hour, 10 checks/recipient/min.
 *  - The SDK injects `Idempotency-Key` on every mutation.
 *  - Phone verification uses E.164 format exclusively.
 *  - SMS country allow-list enforced by Bird (PhoneCountryNotAllowed).
 */

/** Result of creating a verification (sending a code). */
export interface BirdCreateResult {
  id: string;
  status: BirdVerificationStatus;
}

/** Result of checking a verification (confirming a code). */
export interface BirdCheckResult {
  success: boolean;
  reason: string | null;
  attemptsRemaining: number;
  status: BirdVerificationStatus;
  verificationId: string;
}

@Injectable()
export class BirdVerifyService {
  private readonly logger = new Logger(BirdVerifyService.name);

  constructor(private readonly birdService: BirdService) {}

  /** Whether the Bird client is configured. */
  isConfigured(): boolean {
    return this.birdService.isConfigured();
  }

  // ── Email verification ─────────────────────────────────────────────

  /**
   * Creates an email verification — Bird generates a numeric code,
   * delivers it via email (Authifly OTP), and returns the verification ID.
   */
  async createEmailVerification(
    email: string,
    metadata?: Record<string, unknown>,
  ): Promise<BirdCreateResult> {
    const normalizedEmail = normalizeVerifyEmail(email);
    const client = await this.birdService.getClient();
    const params: BirdVerifyCreateParams = {
      to: { email: normalizedEmail },
      ...(metadata ? { metadata } : {}),
    };
    const response: BirdVerificationResponse =
      await client.verify.verifications.create(params);
    return { id: response.id, status: response.status };
  }

  /**
   * Checks an email verification code — Bird compares the hash and
   * returns the result. A wrong code is `200` with `success: false`.
   * An already-resolved verification returns `404`.
   */
  async checkEmailVerification(
    email: string,
    code: string,
  ): Promise<BirdCheckResult> {
    const normalizedEmail = normalizeVerifyEmail(email);
    const normalizedCode = normalizeOtpCode(code);
    const client = await this.birdService.getClient();
    const params: BirdVerifyCheckParams = {
      to: { email: normalizedEmail },
      code: normalizedCode,
    };
    const result: BirdVerificationCheckResult =
      await client.verify.verifications.check(params);
    return {
      success: result.success,
      reason: result.reason ?? null,
      attemptsRemaining: result.attempts_remaining ?? 0,
      status: result.verification?.status ?? "pending",
      verificationId: result.verification?.id ?? "",
    };
  }

  // ── Phone (WhatsApp / SMS) verification ────────────────────────────

  /**
   * Creates a phone verification — Bird generates a numeric code,
   * delivers it via WhatsApp (or specified channels), and returns the verification ID.
   *
   * The phone number must be in E.164 format (e.g. +573001234567).
   * Bird delivers the OTP to the user's WhatsApp line, confirming the number is real.
   */
  async createPhoneVerification(
    phone: string,
    metadata?: Record<string, unknown>,
    options?: { channels?: string[]; language?: string; code_length?: number },
  ): Promise<BirdCreateResult> {
    const normalizedPhone = (phone ?? "").trim();
    if (!isAllowedVerifyPhonePrefix(normalizedPhone)) {
      throw new BadRequestException(
        "Solo se permiten numeros telefonicos en formato E.164 de paises autorizados (+57).",
      );
    }
    const safeCodeLength =
      typeof options?.code_length === "number" &&
      Number.isInteger(options.code_length) &&
      options.code_length >= 4 &&
      options.code_length <= 8
        ? options.code_length
        : undefined;
    const client = await this.birdService.getClient();
    const params: BirdVerifyCreateParams = {
      to: { phone_number: normalizedPhone },
      options: {
        channels: sanitizeVerifyChannels(options?.channels),
        language: options?.language ?? "es",
        ...(safeCodeLength ? { code_length: safeCodeLength } : {}),
      },
      ...(metadata ? { metadata } : {}),
    };
    const response: BirdVerificationResponse =
      await client.verify.verifications.create(params);
    return { id: response.id, status: response.status };
  }

  /**
   * Checks a phone verification code — Bird compares the hash and
   * returns the result. Same semantics as `checkEmailVerification`.
   */
  async checkPhoneVerification(
    phone: string,
    code: string,
  ): Promise<BirdCheckResult> {
    const normalizedPhone = (phone ?? "").trim();
    if (!E164_PATTERN.test(normalizedPhone)) {
      throw new BadRequestException(
        "Número telefónico en formato E.164 inválido.",
      );
    }
    const normalizedCode = normalizeOtpCode(code);
    const client = await this.birdService.getClient();
    const params: BirdVerifyCheckParams = {
      to: { phone_number: normalizedPhone },
      code: normalizedCode,
    };
    const result: BirdVerificationCheckResult =
      await client.verify.verifications.check(params);
    return {
      success: result.success,
      reason: result.reason ?? null,
      attemptsRemaining: result.attempts_remaining ?? 0,
      status: result.verification?.status ?? "pending",
      verificationId: result.verification?.id ?? "",
    };
  }
}
