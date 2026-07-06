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
import type { Request } from "express";
import { SessionGuard } from "../auth/session.guard";
import { NotificationsService } from "./notifications.service";

interface AuthenticatedRequest extends Request {
  user: { userId: string };
}

/**
 * NotificationsController - Endpoints REST para notificaciones a nivel de sistema.
 * Todas las rutas requieren JWT y se sirven bajo /api/notifications.
 */
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @UseGuards(SessionGuard)
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

  @UseGuards(SessionGuard)
  @Post("read-all")
  @HttpCode(HttpStatus.OK)
  async markAllRead(@Req() req: AuthenticatedRequest) {
    const { userId } = req.user;
    const result = await this.notificationsService.markAllRead(userId);
    return result;
  }

  @UseGuards(SessionGuard)
  @Post(":id/read")
  @HttpCode(HttpStatus.OK)
  async markAsRead(
    @Req() req: AuthenticatedRequest,
    @Param("id") notificationId: string,
  ) {
    const { userId } = req.user;
    return this.notificationsService.markAsRead(userId, notificationId);
  }

  @UseGuards(SessionGuard)
  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  async deleteNotification(
    @Req() req: AuthenticatedRequest,
    @Param("id") notificationId: string,
  ) {
    const { userId } = req.user;
    return this.notificationsService.deleteNotification(userId, notificationId);
  }
}
