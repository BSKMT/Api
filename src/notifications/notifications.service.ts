import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import {
  Notification,
  NotificationDocument,
  NotificationPriority,
} from "./schemas/notification.schema";
import { BirdNotifyService } from "../bird/bird-notify.service";
import { BirdRealtimeService } from "../bird/bird-realtime.service";
import { UsersService } from "../users/users.service";
import { sanitizeForLog } from "../common/utils/log-redact.util";

/**
 * NotificationsService - Crea, consulta y marca como leidas las
 * notificaciones a nivel de sistema. Adicionalmente, cuando el usuario
 * tiene canales activados, envia una copia del mensaje por correo y/o
 * SMS a traves de BirdNotifyService, respetando las preferencias del
 * usuario (email/SMS on/off, overrides por categoria).
 *
 * Desde la integracion de Bird Realtime (Fase 1), tambien publica un
 * evento `notification.created` via WebSocket al miembro, de modo que
 * el badge de notificaciones se actualiza en tiempo real. El publish
 * es best-effort: si falla, el polling de respaldo (60s) sigue
 * entregando la notificacion. MongoDB sigue siendo la fuente de verdad.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<NotificationDocument>,
    private readonly birdNotifyService: BirdNotifyService,
    private readonly realtimeService: BirdRealtimeService,
    private readonly usersService: UsersService,
  ) {}

  async create(data: {
    userId: string;
    type: string;
    title: string;
    message: string;
    priority?: string;
    metadata?: Record<string, unknown>;
    relatedReference?: string;
    /** Categoria para overrides por canal (ej: "Membresia y pagos"). */
    notifyCategory?: string;
  }): Promise<NotificationDocument | null> {
    let created: NotificationDocument | null = null;
    try {
      created = await this.notificationModel.create({
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
    }

    if (created && data.userId) {
      this.birdNotifyService
        .notify({
          userId: data.userId,
          title: data.title,
          message: data.message,
          category: data.notifyCategory,
        })
        .catch((err: unknown) => {
          this.logger.warn(
            `Error en dispatch multicanal para usuario ${data.userId}: ${sanitizeForLog(err instanceof Error ? err.message : String(err))}`,
          );
        });
    }

    // Bird Realtime: publish `notification.created` to the member.
    // The member_id in Bird is the Better Auth `user.id` (betterAuthId),
    // which the Astro client uses in `bird.signin()`. We need to look up
    // the user's betterAuthId by their MongoDB _id (data.userId).
    // The publish is fire-and-forget: if it fails, the polling fallback
    // (60s) continues to deliver notifications. MongoDB is always the
    // source of truth — Bird does NOT replay missed events on reconnect.
    if (created && data.userId) {
      try {
        const user = await this.usersService.findById(data.userId);
        if (user?.betterAuthId) {
          this.realtimeService
            .publishToMember(user.betterAuthId, "notification.created", {
              id: created._id.toString(),
              type: data.type,
              title: data.title,
              snippet: data.message.slice(0, 120),
              createdAt:
                created.createdAt?.toISOString?.() ?? new Date().toISOString(),
            })
            .catch((err: unknown) => {
              this.logger.warn(
                `realtime.publishToMember failed — degrading to polling: ${sanitizeForLog(err instanceof Error ? err.message : String(err))}`,
              );
            });
        }
      } catch (err: unknown) {
        this.logger.warn(
          `realtime.publishToMember: user lookup failed for ${data.userId}: ${sanitizeForLog(err instanceof Error ? err.message : String(err))}`,
        );
      }
    }

    return created;
  }

  async getByUser(
    userId: string,
    opts: { limit?: number; onlyUnread?: boolean } = {},
  ): Promise<NotificationDocument[]> {
    const filter: Record<string, unknown> = { userId };
    if (opts.onlyUnread) filter["read"] = false;
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
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
