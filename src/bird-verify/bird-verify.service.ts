import { Injectable, Logger } from "@nestjs/common";
import { BirdService } from "../bird/bird.service";
import type {
  BirdVerificationStatus,
  BirdVerifyCreateParams,
  BirdVerifyCheckParams,
  BirdVerificationResponse,
  BirdVerificationCheckResult,
} from "../bird/bird.service";

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
    const client = await this.birdService.getClient();
    const params: BirdVerifyCreateParams = {
      to: { email_address: email },
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
    const client = await this.birdService.getClient();
    const params: BirdVerifyCheckParams = {
      to: { email_address: email },
      code,
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

  // ── Phone (SMS) verification ───────────────────────────────────────

  /**
   * Creates a phone verification — Bird generates a numeric code,
   * delivers it via SMS, and returns the verification ID.
   *
   * The phone number must be in E.164 format (e.g. +573001234567).
   * Bird enforces a country allow-list for SMS OTPs; numbers outside
   * it are rejected with `422 PhoneCountryNotAllowed`.
   */
  async createPhoneVerification(
    phone: string,
    metadata?: Record<string, unknown>,
  ): Promise<BirdCreateResult> {
    const client = await this.birdService.getClient();
    const params: BirdVerifyCreateParams = {
      to: { phone_number: phone },
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
    const client = await this.birdService.getClient();
    const params: BirdVerifyCheckParams = {
      to: { phone_number: phone },
      code,
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
