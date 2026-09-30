import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { User, UserDocument } from "../users/schemas/user.schema";
import { getAuth, getMongoDb } from "../auth/better-auth";
import { UpdateSettingsDto } from "./dto/update-settings.dto";
import type { Request } from "express";
import { sanitizeForLog } from "../common/utils/log-redact.util";
import {
  DEFAULT_SETTINGS,
  NOTIF_CHANNELS,
  type SessionRow,
  type LeanUser,
} from "./settings.constants";
import { parseUserAgent } from "./settings-ua.helpers";
import {
  discardOrphanSessionFromAuthResponse,
  handlePasswordChange,
} from "./settings-auth.helpers";
import { buildUserDataExport } from "./settings-export.helpers";
import { KvCacheService } from "../kv/kv-cache.service";

import { ObjectId } from "mongodb";

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly kvCache: KvCacheService,
  ) {}

  async getSettings(userId: string) {
    const user = await this.userModel.findById(userId).lean();
    if (!user) throw new NotFoundException("Usuario no encontrado");
    return {
      ...DEFAULT_SETTINGS,
      ...(user.settings as Record<string, unknown>),
    };
  }

  async updateSettings(userId: string, dto: Record<string, unknown>) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException("Usuario no encontrado");

    const settings = user.settings ?? {};
    for (const key of ["notifications", "privacy", "appearance", "dashboard"]) {
      if (dto[key]) {
        const incoming = UpdateSettingsDto.sanitize(
          dto[key] as Record<string, unknown>,
          key,
        );

        if (key === "notifications" && incoming["channels"]) {
          this.validateAtLeastOneChannel(
            incoming["channels"] as Record<string, unknown>,
          );
        }

        settings[key] = {
          ...(settings[key] as Record<string, unknown>),
          ...incoming,
        };
      }
    }

    user.settings = settings;
    user.markModified("settings");
    await user.save();
    this.logger.log(`Settings updated for user ${userId.slice(0, 8)}...`);
    return { ...DEFAULT_SETTINGS, ...settings };
  }

  private validateAtLeastOneChannel(channels: Record<string, unknown>): void {
    const anyEnabled = NOTIF_CHANNELS.some(
      (ch) => channels[ch] === true || channels[ch] === "true",
    );
    if (!anyEnabled) {
      throw new BadRequestException(
        "Debes mantener al menos un canal de notificacion activo (correo, SMS, WhatsApp o push).",
      );
    }
  }

  private buildUserFilter(betterAuthId: string, userId?: string) {
    const ids: (string | ObjectId)[] = [];
    if (betterAuthId) {
      ids.push(betterAuthId);
      if (ObjectId.isValid(betterAuthId)) {
        ids.push(new ObjectId(betterAuthId));
      }
    }
    if (userId && userId !== betterAuthId) {
      ids.push(userId);
      if (ObjectId.isValid(userId)) {
        ids.push(new ObjectId(userId));
      }
    }
    return { userId: { $in: ids } };
  }

  async getSessions(
    userId: string,
    betterAuthId: string,
    currentToken: string,
  ) {
    const db = getMongoDb();
    const query = this.buildUserFilter(betterAuthId, userId);
    const sessions = (await db
      .collection("session")
      .find(query)
      .sort({ createdAt: -1 })
      .toArray()) as unknown as (SessionRow & { _id?: ObjectId })[];

    this.logger.log(
      `getSessions: userId=${userId} betterAuthId=${betterAuthId.substring(0, 10)}... found=${sessions.length} sessions`,
    );

    const cleanCurrentToken = currentToken ? currentToken.split(".")[0] : "";

    return sessions.map((s) => {
      const ua = parseUserAgent(s.userAgent);
      const sid = s._id ? s._id.toString() : String(s.id ?? "");
      const isCurrentSession = Boolean(
        cleanCurrentToken && s.token && s.token === cleanCurrentToken,
      );
      const isActiveSession = s.expiresAt
        ? new Date(s.expiresAt).getTime() > Date.now()
        : true;

      const rawUid = s.userId ?? betterAuthId;
      const uid = typeof rawUid === "string" ? rawUid : rawUid.toString();

      return {
        id: sid,
        userId: uid,
        browser: ua.browser,
        os: ua.os,
        device: ua.device,
        userAgent: s.userAgent ?? `${ua.device} - ${ua.browser}`,
        ipAddress: s.ipAddress ?? "—",
        isCurrent: isCurrentSession,
        isActive: isActiveSession,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        lastActive: s.updatedAt ?? s.createdAt,
      };
    });
  }

  async revokeSession(sessionId: string, betterAuthId: string) {
    if (!sessionId || typeof sessionId !== "string") {
      throw new BadRequestException("ID de sesión inválido");
    }

    const db = getMongoDb();
    const idFilters: Record<string, unknown>[] = [{ id: sessionId }];
    if (ObjectId.isValid(sessionId)) {
      idFilters.push({ _id: new ObjectId(sessionId) });
    } else {
      idFilters.push({ _id: sessionId });
    }

    const userQuery = this.buildUserFilter(betterAuthId);

    // Strict boundary enforcement: must match target session AND belong to this user
    const result = await db.collection("session").deleteOne({
      $or: idFilters,
      ...userQuery,
    });

    if (result.deletedCount === 0) {
      throw new BadRequestException("Sesión no encontrada");
    }
    this.logger.log(`Session revoked: id=${sessionId.substring(0, 10)}...`);
    return { success: true };
  }

  async revokeAllOtherSessions(betterAuthId: string, currentToken: string) {
    const db = getMongoDb();
    const userQuery = this.buildUserFilter(betterAuthId);
    const cleanCurrentToken = currentToken ? currentToken.split(".")[0] : "";

    const filter: Record<string, unknown> = {
      ...userQuery,
    };
    if (cleanCurrentToken) {
      filter["token"] = { $ne: cleanCurrentToken };
    }

    const result = await db.collection("session").deleteMany(filter);
    this.logger.log(
      `Revoked ${result.deletedCount} other sessions for user ${betterAuthId.substring(0, 10)}...`,
    );
    return { revoked: result.deletedCount };
  }

  async requestAccountDeletion(
    userId: string,
    reason?: string,
    password?: string,
  ) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException("Usuario no encontrado");

    if (!password) {
      throw new BadRequestException(
        "Debes confirmar tu contraseña para solicitar la eliminación",
      );
    }

    const auth = await getAuth();
    let authResponse: Response;
    try {
      authResponse = await auth.api.signInEmail({
        body: { email: user.email, password },
        asResponse: true,
      });
    } catch {
      throw new BadRequestException(
        "La contraseña no es válida. Verifica e inténtalo de nuevo.",
      );
    }

    if (!authResponse.ok) {
      throw new BadRequestException(
        "La contraseña no es válida. Verifica e inténtalo de nuevo.",
      );
    }

    if (user.accountDeletionRequested) {
      throw new BadRequestException(
        "Ya tienes una solicitud de eliminacion pendiente",
      );
    }

    user.accountDeletionRequested = true;
    user.accountDeletionRequestedAt = new Date();
    await user.save();
    if (user.betterAuthId) {
      await this.kvCache
        .delete(`user:ba:${user.betterAuthId}`, true)
        .catch(() => {});
    }

    await discardOrphanSessionFromAuthResponse(authResponse, user, this.logger);

    this.logger.log(
      `Account deletion requested by user ${userId}: ${sanitizeForLog(reason ?? "no reason")}`,
    );
    return {
      success: true,
      message:
        "Solicitud de eliminacion enviada. Un administrador la revisara.",
      requestedAt: user.accountDeletionRequestedAt,
    };
  }

  async getDeletionStatus(userId: string) {
    const user = (await this.userModel
      .findById(userId)
      .lean()) as unknown as LeanUser | null;
    if (!user) throw new NotFoundException("Usuario no encontrado");
    return {
      requested: user.accountDeletionRequested ?? false,
      requestedAt: user.accountDeletionRequestedAt ?? null,
    };
  }

  async cancelDeletionRequest(userId: string) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException("Usuario no encontrado");
    user.accountDeletionRequested = false;
    user.accountDeletionRequestedAt = null;
    await user.save();
    if (user.betterAuthId) {
      await this.kvCache
        .delete(`user:ba:${user.betterAuthId}`, true)
        .catch(() => {});
    }
    return { success: true, message: "Solicitud cancelada" };
  }

  async exportUserData(userId: string) {
    return buildUserDataExport(this.userModel, userId);
  }

  async changePassword(
    req: Request,
    currentPassword: string,
    newPassword: string,
  ) {
    return handlePasswordChange(
      req,
      currentPassword,
      newPassword,
      (id, tok) => this.revokeAllOtherSessions(id, tok),
      this.logger,
    );
  }
}
