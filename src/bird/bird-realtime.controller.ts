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
import type { Request } from "express";
import { BirdRealtimeService } from "./bird-realtime.service";
import { BirdService } from "./bird.service";
import { Public } from "../common/decorators/public.decorator";
import { sanitizeForLog } from "../common/utils/log-redact.util";
import { AuthMemberDto, AuthChannelDto } from "./bird-realtime.dto";
import {
  signMemberAuth,
  signChannelAuth,
  processBirdWebhookEvent,
} from "./bird-realtime.helpers";

export { AuthMemberDto, AuthChannelDto };

@Controller()
export class BirdRealtimeController {
  private readonly logger = new Logger(BirdRealtimeController.name);

  constructor(
    private readonly realtimeService: BirdRealtimeService,
    private readonly birdService: BirdService,
  ) {}

  @Post("bird/auth/member")
  @HttpCode(HttpStatus.OK)
  authMember(
    @Req()
    req: Request & {
      user?: { betterAuthId?: string; role?: string; email?: string };
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
    const displayName = req.user?.email ?? "";

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

  @Post("bird/auth/channel")
  @HttpCode(HttpStatus.OK)
  authChannel(
    @Req()
    req: Request & {
      user?: { betterAuthId?: string; role?: string; email?: string };
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
    const displayName = req.user?.email ?? "";

    // Channel-level authorization enforcement
    if (channelName.startsWith("private-user-")) {
      const channelOwner = channelName.slice("private-user-".length);
      const isOwner =
        channelOwner === betterAuthId ||
        channelOwner === (req.user as { userId?: string })?.userId;
      if (!isOwner && role !== "admin") {
        throw new ForbiddenException(
          "No tienes autorización para unirte a este canal privado de usuario",
        );
      }
    }

    if (
      (channelName.startsWith("private-admin") ||
        channelName.startsWith("presence-admin")) &&
      role !== "admin"
    ) {
      throw new ForbiddenException(
        "Acceso denegado a canales de administración",
      );
    }

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
  @Post("internal/webhooks/bird/realtime")
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Body() body: unknown,
  ): Promise<{ received: boolean }> {
    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(body));

    const event = await this.realtimeService.verifyWebhook(
      rawBody,
      req.headers,
    );

    if (!event) {
      throw new ForbiddenException("Invalid webhook signature");
    }

    try {
      processBirdWebhookEvent(this.logger, event);
    } catch (err: unknown) {
      this.logger.error(
        `processWebhookEvent failed (type=${event.type}): ${sanitizeForLog(err instanceof Error ? err.message : String(err))}`,
      );
    }

    return { received: true };
  }
}
