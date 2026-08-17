import { Injectable, Logger } from "@nestjs/common";
import {
  BirdService,
  type BirdClientInstance,
  type BirdRealtimeChannelInfo,
} from "./bird.service";
import { sanitizeForLog } from "../common/utils/log-redact.util";

/**
 * BirdRealtimeService — Server-side publishing, member events, and
 * channel state queries for Bird Realtime.
 *
 * This service wraps the `bird.realtime.*` namespace of the BirdClient
 * (loaded lazily via `@messagebird/sdk`) and provides a clean, typed
 * surface for the rest of the API to use:
 *
 *  - `publishToChannel`       — broadcast an event to one or more channels.
 *  - `publishToMember`         — send a personal event to a member (all tabs/devices).
 *  - `disconnectMember`        — close every connection a member holds (sign-out, ban).
 *  - `queryChannelState`       — check whether a channel is occupied and by whom.
 *  - `verifyWebhook`           — verify and decode a `realtime.*` webhook delivery.
 *
 * Security (OWASP A04:2025 — Cryptographic Failures, A07:2025 — Auth Failures):
 *
 *  - The app secret never leaves the server. It is used for HMAC-SHA256
 *    signing (in the controller) and passed to the SDK for REST auth.
 *  - All publishing is best-effort: a transient Bird API failure is caught
 *    and logged, never propagated to the caller. The polling fallback
 *    remains the source of truth — Bird does not replay missed events.
 *  - Member IDs use the Better Auth `user.id` (16-char cuid), which fits
 *    the 64-char `[_\-=@,.;]` alphabet enforced by Bird's edge.
 *    (OWASP A07: identity verified server-side, never client-supplied.)
 *  - `verifyWebhook` uses `bird.webhooks.unwrap` with the raw body
 *    (Standard Webhooks signature — `webhook-id`, `webhook-timestamp`,
 *    `webhook-signature` headers) to prevent forged webhook injections.
 *    (OWASP A08:2025 — Software and Data Integrity Failures.)
 *
 * Degradation: when `isRealtimeConfigured()` is false (missing env vars),
 * every method is a no-op that logs a debug message and returns. This
 * keeps the feature opt-in and non-breaking. (OWASP A10 — graceful.)
 */
@Injectable()
export class BirdRealtimeService {
  private readonly logger = new Logger(BirdRealtimeService.name);

  constructor(private readonly birdService: BirdService) {}

  /** Checks whether Realtime is configured (appId + key + secret present). */
  isRealtimeConfigured(): boolean {
    return this.birdService.isRealtimeConfigured();
  }

  /** Returns the Realtime app id, or null if not configured. */
  getAppId(): string | null {
    return this.birdService.getRealtimeAppId();
  }

  /** Returns the Realtime key (public), or null. */
  getKey(): string | null {
    return this.birdService.getRealtimeKey();
  }

  /** Returns the Realtime secret (server-only), or null. */
  getSecret(): string | null {
    return this.birdService.getRealtimeSecret();
  }

  /**
   * Lazily resolves the BirdClient and returns the realtime namespace.
   * Throws if Bird is not configured (caller should guard with
   * `isRealtimeConfigured()`).
   */
  private async getClient(): Promise<BirdClientInstance> {
    return this.birdService.getClient();
  }

  // ── Publishing ──────────────────────────────────────────────────────

  /**
   * Publishes an event to one or more channels. Best-effort: a Bird API
   * failure is caught and logged, never propagated.
   *
   * @param channel   Target channel name (up to 100 per publish).
   * @param event     Event name (up to 200 chars, no `bird:` or `client-` prefix).
   * @param data      Event payload (any JSON value, max 10 KB serialized).
   * @param opts.excludeConnectionId  Skip the acting client's connection.
   * @param opts.include              Request channel state (`member_count`,
   *                                  `connection_count`) alongside the publish.
   */
  async publishToChannel(
    channel: string,
    event: string,
    data: unknown,
    opts?: { excludeConnectionId?: string; include?: string[] },
  ): Promise<void> {
    if (!this.isRealtimeConfigured()) {
      this.logger.debug(
        `publishToChannel skipped (realtime not configured): event=${event}`,
      );
      return;
    }
    const appId = this.getAppId()!;
    try {
      const client = await this.getClient();
      await client.realtime.publish(appId, {
        event,
        channels: [channel],
        data,
        exclude_connection_id: opts?.excludeConnectionId,
        include: opts?.include,
      });
    } catch (err: unknown) {
      this.logger.warn(
        `publishToChannel failed (event=${event}, channel=${channel}): ${sanitizeForLog(err instanceof Error ? err.message : String(err))}`,
      );
    }
  }

  /**
   * Publishes an event directly to a member (delivers to every connection
   * that member holds — all tabs, all devices). Best-effort.
   *
   * @param memberId  The Bird member_id (Better Auth user.id).
   * @param event     Event name (no `bird:` or `client-` prefix).
   * @param data      Event payload (any JSON value, max 10 KB serialized).
   */
  async publishToMember(
    memberId: string,
    event: string,
    data: unknown,
  ): Promise<void> {
    if (!this.isRealtimeConfigured()) {
      this.logger.debug(
        `publishToMember skipped (realtime not configured): event=${event}`,
      );
      return;
    }
    const appId = this.getAppId()!;
    try {
      const client = await this.getClient();
      await client.realtime.members.send(appId, memberId, {
        event,
        data,
      });
    } catch (err: unknown) {
      this.logger.warn(
        `publishToMember failed (event=${event}, memberId=${memberId.slice(0, 8)}...): ${sanitizeForLog(err instanceof Error ? err.message : String(err))}`,
      );
    }
  }

  // ── Terminating member connections ──────────────────────────────────

  /**
   * Disconnects every connection that a member holds on this Realtime app.
   * Use after invalidating a session (sign-out, ban, password reset) so
   * that other tabs/devices are immediately closed with code 4009.
   *
   * Best-effort: a Bird API failure is caught and logged.
   */
  async disconnectMember(memberId: string): Promise<void> {
    if (!this.isRealtimeConfigured()) {
      this.logger.debug(`disconnectMember skipped (realtime not configured)`);
      return;
    }
    const appId = this.getAppId()!;
    try {
      const client = await this.getClient();
      await client.realtime.members.disconnect(appId, memberId);
    } catch (err: unknown) {
      this.logger.warn(
        `disconnectMember failed (memberId=${memberId.slice(0, 8)}...): ${sanitizeForLog(err instanceof Error ? err.message : String(err))}`,
      );
    }
  }

  // ── Querying channel state ──────────────────────────────────────────

  /**
   * Queries whether a single channel is occupied and optionally the
   * member/connection count.
   *
   * @returns channel state info, or null on error / not configured.
   */
  async queryChannelState(
    channel: string,
  ): Promise<BirdRealtimeChannelInfo | null> {
    if (!this.isRealtimeConfigured()) return null;
    const appId = this.getAppId()!;
    try {
      const client = await this.getClient();
      const result = await client.realtime.channels.list(appId, {
        prefix: channel,
      });
      return result.data.find((c) => c.name === channel) ?? null;
    } catch (err: unknown) {
      this.logger.warn(
        `queryChannelState failed (channel=${channel}): ${sanitizeForLog(err instanceof Error ? err.message : String(err))}`,
      );
      return null;
    }
  }

  // ── Webhook verification ────────────────────────────────────────────

  /**
   * Verifies and decodes a Bird webhook delivery using Standard Webhooks
   * signature verification (`webhook-id`, `webhook-timestamp`,
   * `webhook-signature` headers).
   *
   * MUST be called with the RAW request body (not re-serialized JSON),
   * because the signature is over bytes.
   *
   * @returns the decoded event, or null if verification fails or
   *          webhook secret is not configured.
   */
  async verifyWebhook(
    rawBody: Buffer | string,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<{
    id: string;
    type: string;
    timestamp: string;
    data: Record<string, unknown>;
  } | null> {
    const webhookSecret = this.birdService.getWebhookSecret();
    if (!webhookSecret) {
      this.logger.warn(
        "verifyWebhook: BIRD_WEBHOOK_SECRET not configured — cannot verify webhook signature.",
      );
      return null;
    }
    try {
      const client = await this.getClient();
      return client.webhooks.unwrap(rawBody, headers);
    } catch (err: unknown) {
      this.logger.warn(
        `verifyWebhook: signature verification failed: ${sanitizeForLog(err instanceof Error ? err.message : String(err))}`,
      );
      return null;
    }
  }
}
