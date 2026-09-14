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

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
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

  async getSessions(
    userId: string,
    betterAuthId: string,
    currentToken: string,
  ) {
    const db = getMongoDb();
    const sessions = (await db
      .collection("session")
      .find({ userId: betterAuthId })
      .sort({ createdAt: -1 })
      .toArray()) as unknown as SessionRow[];

    this.logger.log(
      `getSessions: userId=${userId} betterAuthId=${betterAuthId.substring(0, 10)}... found=${sessions.length} sessions`,
    );

    return sessions.map((s) => {
      const ua = parseUserAgent(s.userAgent);
      return {
        id: s.id,
        browser: ua.browser,
        os: ua.os,
        device: ua.device,
        ipAddress: s.ipAddress ?? "—",
        isCurrent: s.token === currentToken,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        lastActive: s.updatedAt,
      };
    });
  }

  async revokeSession(sessionId: string, betterAuthId: string) {
    const db = getMongoDb();
    const result = await db
      .collection("session")
      .deleteOne({ id: sessionId, userId: betterAuthId });
    if (result.deletedCount === 0) {
      throw new BadRequestException("Sesion no encontrada");
    }
    this.logger.log(`Session revoked: id=${sessionId.substring(0, 10)}...`);
    return { success: true };
  }

  async revokeAllOtherSessions(betterAuthId: string, currentToken: string) {
    const db = getMongoDb();
    const result = await db
      .collection("session")
      .deleteMany({ userId: betterAuthId, token: { $ne: currentToken } });
    this.logger.log(
      `Revoked ${result.deletedCount} other sessions for user ${betterAuthId}`,
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
