import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { User, UserDocument, UserRole } from "../users/schemas/user.schema";
import { ALLOWED_USER_EMAIL_DOMAINS } from "../auth/better-auth-hooks";
import { getMongoDb } from "../auth/better-auth";
import { ObjectId } from "mongodb";
import { BirdVerifyService } from "../bird-verify/bird-verify.service";
import { BirdSmsService } from "../bird/bird-sms.service";
import { BirdEmailService } from "../bird/bird-email.service";
import { maskEmail, sanitizeForLog } from "../common/utils/log-redact.util";
import {
  ChannelThrottleStore,
  handleVerifyCheckResult,
  updateBetterAuthEmail,
  sendEmailChangeSecurityAlert,
} from "./channel-verification.helpers";
import {
  executeInitiatePhoneVerification,
  executeVerifyPhone,
} from "./channel-phone.helpers";
import { KvCacheService } from "../kv/kv-cache.service";

@Injectable()
export class ChannelVerificationService {
  private readonly logger = new Logger(ChannelVerificationService.name);

  private readonly phoneThrottle: ChannelThrottleStore;
  private readonly emailThrottle: ChannelThrottleStore;

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly birdVerifyService: BirdVerifyService,
    private readonly smsService: BirdSmsService,
    private readonly emailService: BirdEmailService,
    private readonly kvCache: KvCacheService,
  ) {
    this.phoneThrottle = new ChannelThrottleStore(
      5 * 60 * 1000,
      3,
      this.kvCache,
    );
    this.emailThrottle = new ChannelThrottleStore(
      5 * 60 * 1000,
      3,
      this.kvCache,
    );
  }

  async initiatePhoneVerification(
    userId: string,
    phone: string,
  ): Promise<void> {
    return executeInitiatePhoneVerification(
      this.userModel,
      this.birdVerifyService,
      this.smsService,
      this.phoneThrottle,
      userId,
      phone,
      this.logger,
    );
  }

  async verifyPhone(
    userId: string,
    phone: string,
    code: string,
  ): Promise<void> {
    return executeVerifyPhone(
      this.userModel,
      this.birdVerifyService,
      userId,
      phone,
      code,
      this.logger,
    );
  }

  async initiateEmailChange(userId: string, newEmail: string): Promise<void> {
    if (!this.birdVerifyService.isConfigured()) {
      throw new BadRequestException(
        "La verificacion por correo no esta disponible en este momento.",
      );
    }

    const normalizedEmail = newEmail.toLowerCase().trim();
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new BadRequestException("Usuario no encontrado");
    }

    if (user.email === normalizedEmail) {
      throw new BadRequestException("El nuevo correo es igual al actual");
    }

    // F-10: Enforce the same ALLOWED_USER_EMAIL_DOMAINS allowlist as signup for non-staff users.
    const isStaff =
      user.role === UserRole.ADMIN ||
      user.role === UserRole.SUPERADMIN ||
      user.role === UserRole.GESTOR ||
      Boolean(user.subrol);
    const domain = normalizedEmail.split("@")[1] ?? "";
    if (
      !ALLOWED_USER_EMAIL_DOMAINS.has(domain) &&
      !(isStaff && domain === "bskmt.com")
    ) {
      throw new BadRequestException(
        "El dominio del correo no está permitido. Usa Microsoft (outlook, hotmail, live), Google (gmail), Apple (icloud, me, mac) o Yahoo.",
      );
    }

    const existing = await this.userModel
      .findOne({ email: normalizedEmail })
      .lean();
    if (existing) {
      throw new ConflictException(
        "No se pudo completar la solicitud. Intenta con otro correo.",
      );
    }

    await this.emailThrottle.enforce(normalizedEmail, this.logger);
    await this.emailThrottle.enforce(`user:${userId}`, this.logger);

    try {
      await this.birdVerifyService.createEmailVerification(normalizedEmail, {
        userId,
        channel: "email-change",
      });
    } catch (err: unknown) {
      this.logger.error(
        `initiateEmailChange: Bird error for ${maskEmail(normalizedEmail)}: ${sanitizeForLog(
          err instanceof Error ? err.message : String(err),
        )}`,
      );
      throw new BadRequestException(
        "No se pudo enviar el codigo de verificacion. Intenta de nuevo.",
      );
    } finally {
      await this.emailThrottle.record(normalizedEmail);
      await this.emailThrottle.record(`user:${userId}`);
    }

    user.pendingEmail = normalizedEmail;
    await user.save();

    await sendEmailChangeSecurityAlert(
      this.emailService,
      user,
      normalizedEmail,
      this.logger,
    );

    this.logger.log(
      `Email change OTP sent to ${maskEmail(normalizedEmail)} for user ${userId}`,
    );
  }

  async verifyEmailChange(
    userId: string,
    newEmail: string,
    code: string,
    currentSessionToken?: string,
  ): Promise<void> {
    const normalizedEmail = newEmail.toLowerCase().trim();
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new BadRequestException("Usuario no encontrado");
    }

    if (user.pendingEmail !== normalizedEmail) {
      throw new BadRequestException(
        "No hay una verificacion pendiente para este correo",
      );
    }

    let result;
    try {
      result = await this.birdVerifyService.checkEmailVerification(
        normalizedEmail,
        code,
      );
    } catch (err: unknown) {
      this.logger.error(
        `verifyEmailChange: Bird error for ${maskEmail(normalizedEmail)}: ${sanitizeForLog(
          err instanceof Error ? err.message : String(err),
        )}`,
      );
      throw new BadRequestException(
        "No se pudo verificar el codigo. Solicita uno nuevo e intenta de nuevo.",
      );
    }

    handleVerifyCheckResult(result, async () => {
      user.pendingEmail = null;
      await user.save();
    });

    // F-10: Re-check email uniqueness immediately before mutating Better-Auth & MongoDB.
    const conflict = await this.userModel
      .findOne({ email: normalizedEmail, _id: { $ne: user._id } })
      .lean();
    if (conflict) {
      user.pendingEmail = null;
      await user.save();
      throw new ConflictException(
        "No se pudo completar el cambio de correo. Intenta con otro correo.",
      );
    }

    await updateBetterAuthEmail(
      user.betterAuthId,
      normalizedEmail,
      this.logger,
    );

    user.email = normalizedEmail;
    user.emailVerified = true;
    user.pendingEmail = null;
    await user.save();

    // F-10: Invalidate auth KV cache and revoke other sessions on email change.
    if (user.betterAuthId) {
      await this.kvCache
        .delete(`user:ba:${user.betterAuthId}`, true)
        .catch(() => {});
      try {
        const db = getMongoDb();
        const userFilters: (string | ObjectId)[] = [user.betterAuthId];
        if (ObjectId.isValid(user.betterAuthId)) {
          userFilters.push(new ObjectId(user.betterAuthId));
        }
        const sessionFilter: Record<string, unknown> = {
          userId: { $in: userFilters },
        };
        if (currentSessionToken) {
          sessionFilter.token = { $ne: currentSessionToken };
        }
        await db.collection("session").deleteMany(sessionFilter);
      } catch (err: unknown) {
        this.logger.warn(
          `verifyEmailChange: failed to revoke other sessions: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    this.logger.log(
      `Email changed to ${maskEmail(normalizedEmail)} for user ${userId}`,
    );
  }
}
