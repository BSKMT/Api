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
import {
  maskEmail,
  maskPhone,
  sanitizeForLog,
} from "../common/utils/log-redact.util";
import {
  ChannelThrottleStore,
  handleVerifyCheckResult,
  updateBetterAuthEmail,
} from "./channel-verification.helpers";

@Injectable()
export class ChannelVerificationService {
  private readonly logger = new Logger(ChannelVerificationService.name);

  private readonly phoneThrottle = new ChannelThrottleStore(5 * 60 * 1000, 3);
  private readonly emailThrottle = new ChannelThrottleStore(5 * 60 * 1000, 3);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly birdVerifyService: BirdVerifyService,
    private readonly smsService: BirdSmsService,
  ) {}

  async initiatePhoneVerification(
    userId: string,
    phone: string,
  ): Promise<void> {
    if (!this.birdVerifyService.isConfigured()) {
      throw new BadRequestException(
        "La verificacion por SMS no esta disponible en este momento.",
      );
    }

    if (!this.smsService.isValidE164(phone)) {
      throw new BadRequestException(
        "El telefono debe estar en formato E.164 (ej: +573001234567)",
      );
    }

    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new BadRequestException("Usuario no encontrado");
    }

    if (user.phone === phone && user.phoneVerified) {
      throw new BadRequestException("Este telefono ya esta verificado");
    }

    this.phoneThrottle.enforce(phone, this.logger);

    try {
      await this.birdVerifyService.createPhoneVerification(phone, {
        userId,
        channel: "sms",
      });
    } catch (err: unknown) {
      this.logger.error(
        `initiatePhoneVerification: Bird error for ${maskPhone(phone)}: ${sanitizeForLog(
          err instanceof Error ? err.message : String(err),
        )}`,
      );
      throw new BadRequestException(
        "No se pudo enviar el codigo SMS. Verifica el numero e intenta de nuevo.",
      );
    }

    user.pendingPhone = phone;
    user.phoneVerified = false;
    await user.save();

    this.phoneThrottle.record(phone);
    this.logger.log(`Phone OTP sent to ${maskPhone(phone)} for user ${userId}`);
  }

  async verifyPhone(
    userId: string,
    phone: string,
    code: string,
  ): Promise<void> {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new BadRequestException("Usuario no encontrado");
    }

    if (user.pendingPhone !== phone) {
      throw new BadRequestException(
        "No hay una verificacion pendiente para este telefono",
      );
    }

    let result;
    try {
      result = await this.birdVerifyService.checkPhoneVerification(phone, code);
    } catch (err: unknown) {
      this.logger.error(
        `verifyPhone: Bird error for ${maskPhone(phone)}: ${sanitizeForLog(
          err instanceof Error ? err.message : String(err),
        )}`,
      );
      throw new BadRequestException(
        "No se pudo verificar el codigo. Solicita uno nuevo e intenta de nuevo.",
      );
    }

    handleVerifyCheckResult(result, async () => {
      user.pendingPhone = null;
      await user.save();
    });

    user.phone = phone;
    user.phoneVerified = true;
    user.phoneVerifiedAt = new Date();
    user.pendingPhone = null;
    await user.save();

    this.logger.log(`Phone ${maskPhone(phone)} verified for user ${userId}`);
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

    this.emailThrottle.enforce(normalizedEmail, this.logger);

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
    }

    user.pendingEmail = normalizedEmail;
    await user.save();

    this.emailThrottle.record(normalizedEmail);
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
