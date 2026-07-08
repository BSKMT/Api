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

const DEFAULT_SETTINGS = {
  notifications: {
    channels: { email: true, sms: true, whatsapp: false, push: false },
    categories: {
      "Rodadas y eventos": {
        email: true,
        sms: true,
        whatsapp: true,
        push: true,
      },
      "ARPHA 24/7": { email: true, sms: true, whatsapp: false, push: true },
      "Tienda BSK": { email: true, sms: false, whatsapp: false, push: false },
      "Academia Ready To Ride": {
        email: true,
        sms: false,
        whatsapp: true,
        push: false,
      },
      "Membresia y pagos": {
        email: true,
        sms: true,
        whatsapp: false,
        push: false,
      },
      "Comunidad BSK": {
        email: false,
        sms: false,
        whatsapp: true,
        push: false,
      },
    },
  },
  privacy: {
    profileVisible: true,
    showLocation: true,
    allowFriendRequests: false,
    shareStats: true,
    showMotorcycle: true,
  },
  appearance: {
    theme: "dark",
    density: "comfortable",
    language: "es-CO",
  },
  dashboard: {
    defaultView: "/panel",
    widgets: {
      "proximos-eventos": true,
      "cursos-en-progreso": true,
      "resumen-actividad": true,
      "actualizaciones-recientes": false,
      "accesos-rapidos": true,
      "banner-membresia": true,
    },
  },
};

interface SessionRow {
  id: string;
  token: string;
  userId: string;
  expiresAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface LeanUser {
  _id: { toString(): string };
  email: string;
  role: string;
  profileCompleted: boolean;
  emailVerified: boolean;
  legalConsentAccepted: boolean;
  isActive: boolean;
  membershipLevel?: string | null;
  membershipStartDate?: Date | null;
  membershipExpiryDate?: Date | null;
  membershipPaymentPlan?: string | null;
  betterAuthId?: string;
  profile?: Record<string, Record<string, unknown>>;
  settings?: Record<string, unknown>;
  accountDeletionRequested?: boolean;
  accountDeletionRequestedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

function parseBrowser(ua: string): string {
  if (/Edg\//.test(ua)) return "Microsoft Edge";
  if (/Chrome\//.test(ua) && !/Chromium\//.test(ua)) return "Google Chrome";
  if (/Firefox\//.test(ua)) return "Mozilla Firefox";
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return "Safari";
  if (/OPR\//.test(ua)) return "Opera";
  return "Desconocido";
}

function parseOS(ua: string): string {
  if (/Windows NT 10/.test(ua)) return "Windows 10/11";
  if (/Windows NT/.test(ua)) return "Windows";
  if (/Mac OS X/.test(ua)) return "macOS";
  if (/Android/.test(ua)) return "Android";
  if (/iPhone|iPad|iPod/.test(ua)) return "iOS";
  if (/Linux/.test(ua)) return "Linux";
  return "Desconocido";
}

function parseDevice(ua: string): string {
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua) && /Mobile/.test(ua)) return "Android Phone";
  if (/Android/.test(ua)) return "Android Tablet";
  if (/Mac/.test(ua)) return "MacBook";
  if (/Windows/.test(ua)) return "Windows PC";
  if (/Linux/.test(ua)) return "Linux PC";
  return "Dispositivo desconocido";
}

function parseUserAgent(ua: string | null): {
  browser: string;
  os: string;
  device: string;
} {
  if (!ua)
    return {
      browser: "Desconocido",
      os: "Desconocido",
      device: "Dispositivo desconocido",
    };
  return {
    browser: parseBrowser(ua),
    os: parseOS(ua),
    device: parseDevice(ua),
  };
}

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
        );
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

  async revokeSession(sessionId: string) {
    const db = getMongoDb();
    const result = await db.collection("session").deleteOne({ id: sessionId });
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

  async requestAccountDeletion(userId: string, reason?: string) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException("Usuario no encontrado");
    if (user.accountDeletionRequested) {
      throw new BadRequestException(
        "Ya tienes una solicitud de eliminacion pendiente",
      );
    }

    user.accountDeletionRequested = true;
    user.accountDeletionRequestedAt = new Date();
    await user.save();

    this.logger.log(
      `Account deletion requested by user ${userId}: ${reason ?? "no reason"}`,
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
    const user = (await this.userModel
      .findById(userId)
      .lean()) as unknown as LeanUser;

    if (!user) throw new NotFoundException("Usuario no encontrado");

    let authData: Record<string, unknown> | null = null;
    try {
      const db = getMongoDb();
      const betterAuthUser = await db
        .collection("user")
        .findOne({ id: user.betterAuthId });
      if (betterAuthUser) {
        authData = {
          id: betterAuthUser.id,
          email: betterAuthUser.email,
          emailVerified: betterAuthUser.emailVerified,
          name: betterAuthUser.name,
          createdAt: betterAuthUser.createdAt,
          twoFactorEnabled: betterAuthUser.twoFactorEnabled ?? false,
        };
      }
    } catch {
      // ignore
    }

    return {
      exportedAt: new Date().toISOString(),
      user: {
        id: user._id.toString(),
        email: user.email,
        role: user.role,
        profileCompleted: user.profileCompleted,
        emailVerified: user.emailVerified,
        legalConsentAccepted: user.legalConsentAccepted,
        isActive: user.isActive,
        membershipLevel: user.membershipLevel,
        membershipStartDate: user.membershipStartDate,
        membershipExpiryDate: user.membershipExpiryDate,
        membershipPaymentPlan: user.membershipPaymentPlan,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      authData,
      profile: user.profile,
      settings: user.settings ?? {},
      accountDeletionRequested: user.accountDeletionRequested,
      accountDeletionRequestedAt: user.accountDeletionRequestedAt,
    };
  }

  async changePassword(
    req: Request,
    currentPassword: string,
    newPassword: string,
  ) {
    const auth = await getAuth();
    try {
      await auth.api.changePassword({
        body: { currentPassword, newPassword },
        headers: req.headers,
      });
      return { success: true, message: "Contraseña actualizada correctamente" };
    } catch {
      throw new BadRequestException("La contrasena actual es incorrecta");
    }
  }

  async enableTwoFactor(req: Request, password: string) {
    const auth = await getAuth();
    try {
      const result = await auth.api.enableTwoFactor({
        body: { password },
        headers: req.headers,
      });
      return result;
    } catch {
      throw new BadRequestException(
        "No se pudo activar 2FA. Verifica tu contrasena.",
      );
    }
  }

  async verifyTwoFactor(req: Request, code: string) {
    const auth = await getAuth();
    try {
      const result = await auth.api.verifyTwoFactorOTP({
        body: { code },
        headers: req.headers,
      });
      return result;
    } catch {
      throw new BadRequestException("Codigo de verificacion incorrecto");
    }
  }

  async disableTwoFactor(req: Request, password: string) {
    const auth = await getAuth();
    try {
      await auth.api.disableTwoFactor({
        body: { password },
        headers: req.headers,
      });
      return { success: true, message: "2FA desactivado" };
    } catch {
      throw new BadRequestException(
        "No se pudo desactivar 2FA. Verifica tu contrasena.",
      );
    }
  }
}
