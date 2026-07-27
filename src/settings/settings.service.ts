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
        // M-12: pass section name to apply per-section whitelist
        const incoming = UpdateSettingsDto.sanitize(
          dto[key] as Record<string, unknown>,
          key,
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

    // M-2: Re-auth used `auth.api.signInEmail({ asResponse: true })` which
    // mints a fresh session in the underlying auth DB even though we
    // never delivered the cookie to the client. That orphan session
    // would have lived for `session.expiresIn` (7 days). Discard it
    // immediately by parsing the Set-Cookie headers from the response
    // and deleting the matching sessions from the `session` collection.
    await this.discardOrphanSessionFromAuthResponse(authResponse, user);

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
    if (newPassword === currentPassword) {
      throw new BadRequestException(
        "La nueva contraseña debe ser diferente a la actual",
      );
    }
    const auth = await getAuth();
    try {
      await auth.api.changePassword({
        body: { currentPassword, newPassword },
        headers: req.headers,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      if (/password/i.test(msg)) {
        throw new BadRequestException(
          "No se pudo cambiar la contraseña. Verifica que la contraseña actual sea correcta.",
        );
      }
      throw new BadRequestException(
        "No se pudo cambiar la contraseña. Inténtalo de nuevo.",
      );
    }

    // M-1: Better Auth changePassword does NOT call revokeSessionsOnPasswordReset
    // implicitly (only the `sendResetPassword` flow does, controlled via
    // `revokeSessionsOnPasswordReset: true` in better-auth config which sets the
    // reset flow). To stop other sessions (e.g., a stolen phone still logged in)
    // after the user changes their password interactively, revoke every session
    // except the one that issued this request.
    const typedReq = req as Request & {
      user?: { userId?: string; betterAuthId?: string };
    };
    const betterAuthId = typedReq.user?.betterAuthId;
    const cookieHeader = req.headers.cookie ?? "";
    const currentToken = this.extractSessionTokenFromCookie(cookieHeader);
    if (betterAuthId && currentToken) {
      try {
        await this.revokeAllOtherSessions(betterAuthId, currentToken);
      } catch (err: unknown) {
        this.logger.warn(
          `Failed to revoke other sessions after password change: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    return { success: true, message: "Contraseña actualizada correctamente" };
  }

  /**
   * M-1: Extract the `better-auth.session_token` (or `__Secure-` variant)
   * value from a Cookie header so we can revoke everyDidn't-other session
   * while preserving the caller's own session.
   */
  private extractSessionTokenFromCookie(cookieHeader: string): string {
    const cookies = cookieHeader.split(";").map((c) => c.trim());
    for (const cookie of cookies) {
      const eq = cookie.indexOf("=");
      if (eq <= 0) continue;
      const name = cookie.slice(0, eq).trim();
      const value = cookie.slice(eq + 1).trim();
      if (
        name === "better-auth.session_token" ||
        name === "__Secure-better-auth.session_token"
      ) {
        return value;
      }
    }
    return "";
  }

  /**
   * M-2: After `auth.api.signInEmail({ asResponse: true })` is used to
   * re-authenticate (for the "request account deletion" flow), Better Auth
   * creates a new session in the `session` collection — even though we
   * never deliver the Set-Cookie header to the client. The new session
   * would persist for `session.expiresIn` (7 days) unattached to any
   * browser. This method parses the Set-Cookie header from the auth
   * response, extracts the new session token, and deletes the matching
   * row so no orphan sessions accumulate.
   */
  private async discardOrphanSessionFromAuthResponse(
    authResponse: Response,
    user: UserDocument,
  ): Promise<void> {
    try {
      const setCookies = authResponse.headers.getSetCookie?.() ?? [];
      for (const sc of setCookies) {
        const semi = sc.indexOf(";");
        const pair = (semi === -1 ? sc : sc.slice(0, semi)).trim();
        const eq = pair.indexOf("=");
        if (eq <= 0) continue;
        const name = pair.slice(0, eq).trim();
        const value = pair.slice(eq + 1).trim();
        if (
          name === "better-auth.session_token" ||
          name === "__Secure-better-auth.session_token"
        ) {
          const db = getMongoDb();
          await db
            .collection("session")
            .deleteOne({ userId: user.betterAuthId, token: value });
          this.logger.log(
            `Discarded orphan session after re-auth for user ${user.betterAuthId}`,
          );
        }
      }
    } catch (err: unknown) {
      this.logger.warn(
        `discardOrphanSessionFromAuthResponse failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
