import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import { SessionGuard } from "../auth/session.guard";
import { NotificationsService } from "./notifications.service";
import { ParseObjectIdPipe } from "../common/pipes/parse-object-id.pipe";

interface AuthenticatedRequest extends Request {
  user: { userId: string };
}

/**
 * NotificationsController - Endpoints REST para notificaciones a nivel de sistema.
 * Todas las rutas requieren sesión y se sirven bajo /api/notifications.
 */
@Controller("notifications")
@UseGuards(SessionGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  async listNotifications(
    @Req() req: AuthenticatedRequest,
    @Query("limit") limit?: string,
    @Query("unread") unread?: string,
  ) {
    const { userId } = req.user;
    const onlyUnread = unread === "true" || unread === "1";
    const limitNum = limit ? Number.parseInt(limit, 10) : undefined;
    const items = await this.notificationsService.getByUser(userId, {
      limit: Number.isFinite(limitNum) ? limitNum : undefined,
      onlyUnread,
    });
    const unreadCount = await this.notificationsService.countUnread(userId);
    return { items, unreadCount };
  }

  @Post("read-all")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async markAllRead(@Req() req: AuthenticatedRequest) {
    const { userId } = req.user;
    const result = await this.notificationsService.markAllRead(userId);
    return result;
  }

  @Post(":id/read")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  // B-9: Validate notificationId is a valid ObjectId
  async markAsRead(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseObjectIdPipe) notificationId: string,
  ) {
    const { userId } = req.user;
    return this.notificationsService.markAsRead(userId, notificationId);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  async deleteNotification(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseObjectIdPipe) notificationId: string,
  ) {
    const { userId } = req.user;
    return this.notificationsService.deleteNotification(userId, notificationId);
  }
}
