import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { User, UserDocument } from "../users/schemas/user.schema";
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

    await updateBetterAuthEmail(
      user.betterAuthId,
      normalizedEmail,
      this.logger,
    );

    user.email = normalizedEmail;
    user.emailVerified = true;
    user.pendingEmail = null;
    await user.save();

    this.logger.log(
      `Email changed to ${maskEmail(normalizedEmail)} for user ${userId}`,
    );
  }
}
