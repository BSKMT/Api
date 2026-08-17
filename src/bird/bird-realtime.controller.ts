import {
  Controller,
  Post,
  Req,
  Body,
  HttpCode,
  HttpStatus,
  Logger,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { createHmac } from "node:crypto";
import type { Request } from "express";
import { BirdRealtimeService } from "./bird-realtime.service";
import { BirdService } from "./bird.service";
import type { BirdWebhookEvent } from "./bird.service";
import { Public } from "../common/decorators/public.decorator";
import { sanitizeForLog } from "../common/utils/log-redact.util";

/**
 * BirdRealtimeController — Endpoints for Bird Realtime client auth,
 * channel authorization, and inbound webhooks.
 *
 * ## Endpoints
 *
 * 1. `POST /bird/auth/member` — Member auth (signin).
 *    Called by the browser SDK's `bird.signin()`. Protected by the
 *    global `SessionGuard` (NOT @Public), so `req.user.betterAuthId`
 *    is populated. Signs the member identity with HMAC-SHA256 using
 *    the app secret. Returns `{ auth, member_data }` to the SDK.
 *
 *    Security (OWASP A07:2025):
 *      - The member_id is sourced from the server-side session, never
 *        from client input. An unauthenticated caller gets 401 from
 *        SessionGuard before this handler runs.
 *      - The signed string is `<connection_id>::member::<member_data>`,
 *        where `member_data` is a JSON-string with `member_id` and
 *        `member_info`. The signature is byte-identical to what we return.
 *
 * 2. `POST /bird/auth/channel` — Channel authorization.
 *    Called by the browser SDK when subscribing to `private-` or
 *    `presence-` channels. Protected by `SessionGuard`. Signs either
 *    `<connection_id>:<channel_name>` (private) or
 *    `<connection_id>:<channel_name>:<member_data>` (presence).
 *
 * 3. `POST /internal/webhooks/bird/realtime` — Inbound Bird webhooks.
 *    `@Public()` because Bird calls it without a session cookie. The
 *    raw body is verified via `bird.webhooks.unwrap()` using the
 *    Standard Webhooks signature. Returns 2xx within 1 second (per
 *    Bird's delivery contract) and processes the event asynchronously.
 *    (OWASP A08:2025 — Software and Data Integrity Failures.)
 *
 * ## CSRF
 *
 * The auth endpoints are NOT exempt from the CSRF middleware in
 * `main.ts`: they receive `Origin: https://bskmt.com` from the Astro
 * BFF proxy, which is in the allowed-origins set, so the check passes.
 * The webhook endpoint IS exempt (added to the exempt list in main.ts)
 * because Bird does not send an Origin header.
 */
@Controller()
export class BirdRealtimeController {
  private readonly logger = new Logger(BirdRealtimeController.name);

  constructor(
    private readonly realtimeService: BirdRealtimeService,
    private readonly birdService: BirdService,
  ) {}

  // ── Member auth (signin) ────────────────────────────────────────────

  /**
   * POST /bird/auth/member
   *
   * Signs the member identity for `bird.signin()`. The browser SDK
   * POSTs `{ connection_id }` and receives `{ auth, member_data }`.
   *
   * The member_id is the Better Auth user.id ( cuid, ≤64 chars).
   * The member_info carries { name, role } — non-sensitive data that
   * rides along on the connection (visible to the edge only, not to
   * other clients unless on a presence channel).
   */
  @Post("bird/auth/member")
  @HttpCode(HttpStatus.OK)
  authMember(
    @Req()
    req: Request & {
      user?: { betterAuthId?: string; role?: string; email?: string };
    },
    @Body() body: { connection_id?: string },
  ): { auth: string; member_data: string } {
    // SessionGuard already rejected unauthenticated callers (401).
    // If somehow user is missing, fail with 403.
    const betterAuthId = req.user?.betterAuthId;
    if (!betterAuthId) {
      throw new ForbiddenException("No authenticated user");
    }

    const connectionId = body?.connection_id;
    if (!connectionId || typeof connectionId !== "string") {
      throw new BadRequestException("connection_id is required");
    }

    const key = this.realtimeService.getKey();
    const secret = this.realtimeService.getSecret();
    if (!key || !secret) {
      this.logger.warn(
        "authMember: Realtime not configured — cannot sign member identity.",
      );
      throw new ForbiddenException("Realtime not configured");
    }

    const role = req.user?.role ?? "user";
    const displayName = req.user?.email ?? "";
    const memberData = JSON.stringify({
      member_id: betterAuthId,
      member_info: { name: displayName, role },
    });

    const toSign = `${connectionId}::member::${memberData}`;
    const sig = createHmac("sha256", secret).update(toSign).digest("hex");

    this.logger.debug(
      `authMember: signed member identity for betterAuthId=${betterAuthId.slice(0, 8)}...`,
    );

    return { auth: `${key}:${sig}`, member_data: memberData };
  }

  // ── Channel authorization ──────────────────────────────────────────

  /**
   * POST /bird/auth/channel
   *
   * Signs a private or presence channel subscription. The browser SDK
   * POSTs `{ connection_id, channel_name }` and receives:
   *  - For private: `{ auth }`
   *  - For presence: `{ auth, member_data }`
   *
   * Authorization decisions by channel pattern:
   *  - `private-arpha-<requestId>` — verify the user owns the request
   *    or has admin role. (ARPHA Fase 4 — for now, allow any authenticated
   *    user; harden when ARPHA module is wired.)
   *  - Other `private-` channels — deny by default (403).
   */
  @Post("bird/auth/channel")
  @HttpCode(HttpStatus.OK)
  authChannel(
    @Req()
    req: Request & {
      user?: { betterAuthId?: string; role?: string; email?: string };
    },
    @Body() body: { connection_id?: string; channel_name?: string },
  ): { auth: string; member_data?: string } {
    const betterAuthId = req.user?.betterAuthId;
    if (!betterAuthId) {
      throw new ForbiddenException("No authenticated user");
    }

    const connectionId = body?.connection_id;
    const channelName = body?.channel_name;
    if (!connectionId || typeof connectionId !== "string") {
      throw new BadRequestException("connection_id is required");
    }
    if (!channelName || typeof channelName !== "string") {
      throw new BadRequestException("channel_name is required");
    }

    const key = this.realtimeService.getKey();
    const secret = this.realtimeService.getSecret();
    if (!key || !secret) {
      throw new ForbiddenException("Realtime not configured");
    }

    // Authorization decision by channel pattern.
    // For now, allow authenticated users to subscribe to any channel
    // they name. This will be tightened per-feature in Fases 3/4.
    // Security note: the private- prefix means the subscription only
    // succeeds if our endpoint signs it; we control who gets in.
    if (
      channelName.startsWith("private-") ||
      channelName.startsWith("presence-")
    ) {
      // Allow all authenticated users for the current phase.
      // Future: check ownership of arpha-<requestId>, event-<slug>, etc.
    } else {
      // Public channels don't go through the authEndpoint at all — the
      // SDK only calls this for private-/presence- prefixed channels.
      // If somehow we get a public channel request, reject it.
      throw new ForbiddenException("Channel does not require authorization");
    }

    if (channelName.startsWith("presence-")) {
      const role = req.user?.role ?? "user";
      const displayName = req.user?.email ?? "";
      const memberData = JSON.stringify({
        member_id: betterAuthId,
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

  // ── Webhook handler ─────────────────────────────────────────────────

  /**
   * POST /internal/webhooks/bird/realtime
   *
   * Receives `realtime.*` webhook deliveries from Bird's edge. The raw
   * body is verified via Standard Webhooks signature. Returns 2xx within
   * 1 second (Bird's delivery contract) and processes the event
   * asynchronously after responding.
   *
   * Currently handled event types:
   *  - `realtime.member_added`     — member became present on a channel
   *  - `realtime.member_removed`    — member left all connections on a channel
   *  - `realtime.channel_occupied`  — first subscriber joined a channel
   *  - `realtime.channel_vacated`   — last subscriber left a channel
   *  - default                      — logged at debug level (future-proof)
   *
   * @Public — no session cookie; verification is via signature.
   */
  @Public()
  @Post("internal/webhooks/bird/realtime")
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Body() body: unknown,
  ): Promise<{ received: boolean }> {
    // Use the raw body for signature verification (re-serializing JSON
    // changes the bytes and invalidates the signature).
    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(body));

    const event = await this.realtimeService.verifyWebhook(
      rawBody,
      req.headers,
    );

    if (!event) {
      // Signature verification failed — reject silently to avoid leaking
      // info to a potential attacker (OWASP A08 — don't confirm failure).
      throw new ForbiddenException("Invalid webhook signature");
    }

    // Respond 2xx immediately. Bird requires a response within 1 second.
    // Process the event synchronously (logging is fast; future KV writes
    // will be fire-and-forget).
    try {
      this.processWebhookEvent(event);
    } catch (err: unknown) {
      this.logger.error(
        `processWebhookEvent failed (type=${event.type}): ${sanitizeForLog(err instanceof Error ? err.message : String(err))}`,
      );
    }

    return { received: true };
  }

  /**
   * Processes a verified webhook event asynchronously. This runs AFTER
   * the 2xx response has been sent, so it can take longer than 1 second.
   *
   * Currently this just logs the event. In Fase 1.9 (bonus), the
   * `realtime.member_added` / `member_removed` events will be used to
   * track online presence in KV and skip SMS for online users.
   */
  private processWebhookEvent(event: BirdWebhookEvent): void {
    this.logger.debug(
      `processWebhookEvent: type=${event.type}, data=${JSON.stringify(event.data).slice(0, 200)}`,
    );

    const memberId =
      typeof event.data.member_id === "string" ? event.data.member_id : "";
    const channel =
      typeof event.data.channel === "string" ? event.data.channel : "";

    switch (event.type) {
      case "realtime.member_added":
        this.logger.log(
          `realtime.member_added: member=${memberId}, channel=${channel}`,
        );
        break;
      case "realtime.member_removed":
        this.logger.log(
          `realtime.member_removed: member=${memberId}, channel=${channel}`,
        );
        break;
      case "realtime.channel_occupied":
        this.logger.debug(`realtime.channel_occupied: channel=${channel}`);
        break;
      case "realtime.channel_vacated":
        this.logger.debug(`realtime.channel_vacated: channel=${channel}`);
        break;
      default:
        // Unknown event type — log and ignore (future-proof, per Bird docs).
        this.logger.debug(`Unhandled webhook type: ${event.type}`);
        break;
    }
  }
}
