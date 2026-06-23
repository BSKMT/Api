import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import {
  Notification,
  NotificationDocument,
  NotificationPriority,
} from "./schemas/notification.schema";

/**
 * NotificationsService - Crea, consulta y marca como leídas las notificaciones
 * a nivel de sistema (sin envío por correo todavía).
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<NotificationDocument>,
  ) {}

  async create(data: {
    userId: string;
    type: string;
    title: string;
    message: string;
    priority?: string;
    metadata?: Record<string, unknown>;
    relatedReference?: string;
  }): Promise<NotificationDocument | null> {
    try {
      return await this.notificationModel.create({
        userId: data.userId,
        type: data.type,
        title: data.title,
        message: data.message,
        priority: data.priority ?? NotificationPriority.MEDIUM,
        metadata: data.metadata ?? {},
        relatedReference: data.relatedReference,
      });
    } catch (err: unknown) {
      this.logger.warn(
        `Failed to create notification: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  async getByUser(
    userId: string,
    opts: { limit?: number; onlyUnread?: boolean } = {},
  ): Promise<NotificationDocument[]> {
    const filter: Record<string, unknown> = { userId };
    if (opts.onlyUnread) filter["read"] = false;
    const limit = Math.min(opts.limit ?? 50, 100);
    return this.notificationModel
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  }

  async countUnread(userId: string): Promise<number> {
    return this.notificationModel.countDocuments({
      userId,
      read: false,
    });
  }

  async markAsRead(
    userId: string,
    notificationId: string,
  ): Promise<NotificationDocument | null> {
    const updated = await this.notificationModel.findOneAndUpdate(
      { _id: notificationId, userId },
      { read: true },
      { new: true },
    );
    if (!updated) {
      throw new NotFoundException("Notificación no encontrada");
    }
    return updated;
  }

  async markAllRead(userId: string): Promise<{ modifiedCount: number }> {
    const result = await this.notificationModel.updateMany(
      { userId, read: false },
      { read: true },
    );
    return { modifiedCount: result.modifiedCount };
  }

  async deleteNotification(
    userId: string,
    notificationId: string,
  ): Promise<{ deleted: boolean }> {
    const result = await this.notificationModel.deleteOne({
      _id: notificationId,
      userId,
    });
    if (result.deletedCount === 0) {
      throw new NotFoundException("Notificación no encontrada");
    }
    return { deleted: true };
  }
}
