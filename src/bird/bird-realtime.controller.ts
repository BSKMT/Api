import {
  Controller,
  Get,
  Post,
  Req,
  Body,
  HttpCode,
  HttpStatus,
  Logger,
  ForbiddenException,
  BadRequestException,
  Inject,
  Optional,
  UseGuards,
  forwardRef,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import { SessionGuard } from "../auth/session.guard";
import { BirdRealtimeService } from "./bird-realtime.service";
import { BirdService } from "./bird.service";
import { TicketsService } from "../tickets/tickets.service";
import { KvCacheService } from "../kv/kv-cache.service";
import {
  SecurityAuditService,
  AuditSeverity,
} from "../common/audit/security-audit.service";
import { Public } from "../common/decorators/public.decorator";
import { sanitizeForLog } from "../common/utils/log-redact.util";
import { AuthMemberDto, AuthChannelDto } from "./bird-realtime.dto";
import {
  signMemberAuth,
  signChannelAuth,
  processBirdWebhookEvent,
  assertChannelAuthorized,
} from "./bird-realtime.helpers";

export { AuthMemberDto, AuthChannelDto };

const WEBHOOK_DEDUP_TTL_SECONDS = 86_400; // 24 hours
const MAX_LOCAL_DEDUP_ENTRIES = 500;

@Controller()
@UseGuards(SessionGuard)
export class BirdRealtimeController {
  private readonly logger = new Logger(BirdRealtimeController.name);
  private readonly seenWebhookIds = new Map<string, number>();

  constructor(
    private readonly realtimeService: BirdRealtimeService,
    private readonly birdService: BirdService,
    @Optional()
    @Inject(forwardRef(() => TicketsService))
    private readonly ticketsService?: TicketsService,
    @Optional()
    private readonly kvCache?: KvCacheService,
    @Optional()
    private readonly securityAuditService?: SecurityAuditService,
  ) {}

  private extractWebhookId(req: Request): string | null {
    const raw = req.headers["webhook-id"];
    const val = Array.isArray(raw) ? raw[0] : raw;
    if (typeof val !== "string") return null;
    const trimmed = val.trim();
    return trimmed.length > 0 && trimmed.length <= 128 ? trimmed : null;
  }

  private async isDuplicateWebhook(webhookId: string): Promise<boolean> {
    const now = Date.now();
    const localExp = this.seenWebhookIds.get(webhookId);
    if (localExp && localExp > now) {
      return true;
    }
    if (localExp) {
      this.seenWebhookIds.delete(webhookId);
    }
    if (this.kvCache) {
      try {
        const seen = await this.kvCache.get<boolean>(
          `bird:wh:${webhookId}`,
          true,
        );
        if (seen === true) {
          this.rememberLocalWebhookId(webhookId);
          return true;
        }
      } catch {
        // Degrade gracefully when KV is unavailable
      }
    }
    return false;
  }

  private rememberLocalWebhookId(webhookId: string): void {
    if (this.seenWebhookIds.size >= MAX_LOCAL_DEDUP_ENTRIES) {
      const oldest = this.seenWebhookIds.keys().next().value;
      if (oldest !== undefined) {
        this.seenWebhookIds.delete(oldest);
      }
    }
    this.seenWebhookIds.set(
      webhookId,
      Date.now() + WEBHOOK_DEDUP_TTL_SECONDS * 1000,
    );
  }

  private async markWebhookProcessed(webhookId: string): Promise<void> {
    this.rememberLocalWebhookId(webhookId);
    if (this.kvCache) {
      await this.kvCache
        .set(`bird:wh:${webhookId}`, true, WEBHOOK_DEDUP_TTL_SECONDS, true)
        .catch(() => {});
    }
  }

  @Public()
  @Throttle({
    default: { ttl: 60000, limit: 60 },
    medium: { ttl: 10000, limit: 20 },
  })
  @Get("bird/config")
  @HttpCode(HttpStatus.OK)
  getConfig(): { key: string | null; region: string } {
    return {
      key: this.realtimeService.getKey(),
      region: this.realtimeService.getRegion(),
    };
  }

  @Throttle({
    default: { ttl: 60000, limit: 30 },
    medium: { ttl: 10000, limit: 10 },
  })
  @Post("bird/auth/member")
  @HttpCode(HttpStatus.OK)
  authMember(
    @Req()
    req: Request & {
      user?: {
        betterAuthId?: string;
        role?: string;
        name?: string;
        email?: string;
      };
    },
    @Body() body: AuthMemberDto,
  ): { auth: string; member_data: string } {
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
    const displayName = req.user?.name ?? "";

    const result = signMemberAuth(
      key,
      secret,
      connectionId,
      betterAuthId,
      role,
      displayName,
    );

    this.logger.debug(
      `authMember: signed member identity for betterAuthId=${betterAuthId.slice(0, 8)}...`,
    );

    return result;
  }

  @Throttle({
    default: { ttl: 60000, limit: 40 },
    medium: { ttl: 10000, limit: 12 },
  })
  @Post("bird/auth/channel")
  @HttpCode(HttpStatus.OK)
  authChannel(
    @Req()
    req: Request & {
      user?: {
        betterAuthId?: string;
        role?: string;
        name?: string;
        email?: string;
      };
    },
    @Body() body: AuthChannelDto,
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

    if (
      !channelName.startsWith("private-") &&
      !channelName.startsWith("presence-")
    ) {
      throw new ForbiddenException("Channel does not require authorization");
    }

    const role = req.user?.role ?? "user";
    const displayName = req.user?.name ?? "";
    const typedUser = req.user as {
      userId?: string;
      adminPermissions?: string[];
      authPortal?: string;
    };
    const userId = typedUser?.userId;
    const adminPermissions = typedUser?.adminPermissions ?? [];
    const authPortal = typedUser?.authPortal ?? "standard";

    // F-12 / M-12: Channel-level authorization enforcement with strict whitelist, adminPermissions & authPortal
    assertChannelAuthorized(
      channelName,
      betterAuthId,
      userId,
      role,
      adminPermissions,
      authPortal,
    );

    return signChannelAuth(
      key,
      secret,
      connectionId,
      channelName,
      betterAuthId,
      role,
      displayName,
    );
  }

  @Public()
  @Throttle({
    default: { ttl: 60000, limit: 120 },
    medium: { ttl: 10000, limit: 40 },
  })
  @Post("internal/webhooks/bird/realtime")
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Req() req: Request & { rawBody?: Buffer; requestId?: string },
    @Body() body: unknown,
  ): Promise<{ received: boolean; duplicate?: boolean }> {
    const rawBody = req.rawBody;
    if (!rawBody || rawBody.length === 0) {
      this.logger.warn(
        "Bird webhook rejected: rawBody missing for Standard Webhooks verification.",
      );
      throw new ForbiddenException("Invalid webhook signature");
    }

    const event = await this.realtimeService.verifyWebhook(
      rawBody,
      req.headers,
    );

    if (!event) {
      void this.securityAuditService?.recordEvent({
        requestId: req.requestId || "bird-webhook",
        eventType: "BIRD_WEBHOOK_INVALID_SIGNATURE",
        severity: AuditSeverity.WARN,
        clientIp: req.ip || "unknown",
        method: req.method,
        path: req.originalUrl || "/api/internal/webhooks/bird/realtime",
        statusCode: HttpStatus.FORBIDDEN,
        userAgent: req.headers["user-agent"] || null,
      });
      throw new ForbiddenException("Invalid webhook signature");
    }

    const webhookId = this.extractWebhookId(req);
    if (webhookId && (await this.isDuplicateWebhook(webhookId))) {
      this.logger.debug(
        `Bird webhook duplicate skipped (webhook-id=${sanitizeForLog(webhookId)})`,
      );
      return { received: true, duplicate: true };
    }

    let processedOk = false;
    try {
      await processBirdWebhookEvent(
        this.logger,
        event,
        this.ticketsService,
        (inboundId) => this.realtimeService.fetchInboundEmailBody(inboundId),
      );
      processedOk = true;
    } catch (err: unknown) {
      this.logger.error(
        `processWebhookEvent failed (type=${event.type}): ${sanitizeForLog(err instanceof Error ? err.message : String(err))}`,
      );
    }

    if (processedOk && webhookId) {
      await this.markWebhookProcessed(webhookId);
    }

    void body;
    return { received: true };
  }
}
