import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { User, UserDocument } from "../users/schemas/user.schema";
import { BirdVerifyService } from "../bird-verify/bird-verify.service";
import { BirdSmsService } from "../bird/bird-sms.service";
import { getMongoDb } from "../auth/better-auth";
import {
  maskEmail,
  maskPhone,
  sanitizeForLog,
} from "../common/utils/log-redact.util";

/**
 * ChannelVerificationService — Verifies that a user controls the email
 * address and phone number they register or update, so that
 * notifications (email + SMS) are only dispatched to confirmed channels.
 *
 * Two flows:
 *
 *  1. **Phone verification** (SMS OTP via Bird Verify):
 *     `initiatePhoneVerification(userId, phone)` → Bird sends a code.
 *     `verifyPhone(userId, phone, code)` → Bird checks the code; on
 *     success the user's `phone` is committed and `phoneVerified` is
 *     set to `true`.
 *
 *  2. **Email change** (OTP via Bird Verify):
 *     `initiateEmailChange(userId, newEmail)` → Bird sends a code to
 *     the new address. `verifyEmailChange(userId, newEmail, code)` →
 *     Bird checks the code; on success the email is committed in both
 *     the Better Auth `user` collection and the Mongoose `users`
 *     collection, and `emailVerified` is set to `true`.
 *
 * Security (OWASP A07:2025, A06:2025, A04:2025):
 *
 *  - **Throttle per-recipient**: max 3 sends / 5 min per phone or email
 *    (layered on top of Bird's native 5 sends/recipient/hour cap).
 *  - **Anti-enumeration**: email-in-use is not revealed during change;
 *    returns a generic message.
 *  - **Staged commit**: the new phone or email is only persisted after
 *    the OTP is verified. `pendingPhone`/`pendingEmail` hold the
 *    in-flight value and are cleared on success or expiry.
 *  - **Idempotency**: Bird SDK injects `Idempotency-Key` on every call.
 *  - **E.164 enforcement**: phone numbers must match the strict pattern
 *    before any API call.
 *  - **Single-use, time-bound**: Bird enforces 10-min expiry and max 5
 *    attempts. The app treats the first definitive answer as final.
 *  - **No client-side trust**: verification flags are authoritative
 *    server-side; the client cannot set `phoneVerified`/`emailVerified`.
 */
@Injectable()
export class ChannelVerificationService {
  private readonly logger = new Logger(ChannelVerificationService.name);

  private readonly PHONE_WINDOW_MS = 5 * 60 * 1000;
  private readonly PHONE_MAX_SENDS = 3;
  private readonly EMAIL_WINDOW_MS = 5 * 60 * 1000;
  private readonly EMAIL_MAX_SENDS = 3;

  private readonly phoneSends = new Map<string, number[]>();
  private readonly emailSends = new Map<string, number[]>();

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly birdVerifyService: BirdVerifyService,
    private readonly smsService: BirdSmsService,
  ) {}

  // ── Phone verification ─────────────────────────────────────────────

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

    this.enforceThrottle(
      phone,
      this.phoneSends,
      this.PHONE_WINDOW_MS,
      this.PHONE_MAX_SENDS,
    );

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

    this.recordSend(phone, this.phoneSends);
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

    if (!result.success) {
      if (
        result.reason === "expired" ||
        result.reason === "attempts_exhausted"
      ) {
        user.pendingPhone = null;
        await user.save();
        throw new HttpException(
          "El codigo ha expirado o se agotaron los intentos. Solicita uno nuevo.",
          HttpStatus.GONE,
        );
      }
      throw new BadRequestException(
        `Codigo incorrecto. Intentos restantes: ${result.attemptsRemaining}`,
      );
    }

    user.phone = phone;
    user.phoneVerified = true;
    user.phoneVerifiedAt = new Date();
    user.pendingPhone = null;
    await user.save();

    this.logger.log(`Phone ${maskPhone(phone)} verified for user ${userId}`);
  }

  // ── Email change verification ──────────────────────────────────────

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

    this.enforceThrottle(
      normalizedEmail,
      this.emailSends,
      this.EMAIL_WINDOW_MS,
      this.EMAIL_MAX_SENDS,
    );

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

    this.recordSend(normalizedEmail, this.emailSends);
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

    if (!result.success) {
      if (
        result.reason === "expired" ||
        result.reason === "attempts_exhausted"
      ) {
        user.pendingEmail = null;
        await user.save();
        throw new HttpException(
          "El codigo ha expirado o se agotaron los intentos. Solicita uno nuevo.",
          HttpStatus.GONE,
        );
      }
      throw new BadRequestException(
        `Codigo incorrecto. Intentos restantes: ${result.attemptsRemaining}`,
      );
    }

    try {
      const db = getMongoDb();
      await db.collection("user").updateOne(
        { id: user.betterAuthId },
        {
          $set: {
            email: normalizedEmail,
            emailVerified: true,
            updatedAt: new Date(),
          },
        },
      );
    } catch (err: unknown) {
      this.logger.error(
        `verifyEmailChange: Failed to update Better Auth user: ${sanitizeForLog(
          err instanceof Error ? err.message : String(err),
        )}`,
      );
      throw new BadRequestException(
        "No se pudo actualizar el correo. Intenta de nuevo.",
      );
    }

    user.email = normalizedEmail;
    user.emailVerified = true;
    user.pendingEmail = null;
    await user.save();

    this.logger.log(
      `Email changed to ${maskEmail(normalizedEmail)} for user ${userId}`,
    );
  }

  // ── Throttle helpers ───────────────────────────────────────────────

  private enforceThrottle(
    key: string,
    store: Map<string, number[]>,
    windowMs: number,
    maxSends: number,
  ): void {
    const now = Date.now();
    const cutoff = now - windowMs;
    const timestamps = (store.get(key) ?? []).filter((t) => t > cutoff);
    if (timestamps.length >= maxSends) {
      this.logger.warn(
        `Throttle: ${maskPhone(key)} exceeded ${maxSends} sends in ${windowMs / 1000}s`,
      );
      throw new HttpException(
        "Has solicitado demasiados codigos. Espera 5 minutos e intenta de nuevo.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private recordSend(key: string, store: Map<string, number[]>): void {
    const now = Date.now();
    const cutoff = now - this.PHONE_WINDOW_MS;
    const timestamps = (store.get(key) ?? []).filter((t) => t > cutoff);
    timestamps.push(now);
    store.set(key, timestamps);
  }
}
