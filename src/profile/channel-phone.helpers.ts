import { BadRequestException, ConflictException, Logger } from "@nestjs/common";
import { Model } from "mongoose";
import { UserDocument } from "../users/schemas/user.schema";
import { BirdVerifyService } from "../bird-verify/bird-verify.service";
import { BirdSmsService } from "../bird/bird-sms.service";
import { maskPhone, sanitizeForLog } from "../common/utils/log-redact.util";
import {
  ChannelThrottleStore,
  handleVerifyCheckResult,
} from "./channel-verification.helpers";
import { normalizePhone } from "./dto/verify-channel.dto";

export async function executeInitiatePhoneVerification(
  userModel: Model<UserDocument>,
  birdVerifyService: BirdVerifyService,
  smsService: BirdSmsService,
  phoneThrottle: ChannelThrottleStore,
  userId: string,
  phone: string,
  logger: Logger,
): Promise<void> {
  if (!birdVerifyService.isConfigured()) {
    throw new BadRequestException(
      "El servicio de verificación de teléfono no está disponible en este momento.",
    );
  }

  const normalizedPhone = normalizePhone(phone);

  if (!smsService.isValidE164(normalizedPhone)) {
    throw new BadRequestException(
      "El teléfono debe estar en formato E.164 (ej: +573001234567)",
    );
  }

  if (!smsService.isAllowedCountryPrefix(normalizedPhone)) {
    throw new BadRequestException(
      "Solo se permiten números telefónicos de países autorizados (+57).",
    );
  }

  const user = await userModel.findById(userId);
  if (!user) {
    throw new BadRequestException("Usuario no encontrado");
  }

  if (user.phone === normalizedPhone && user.phoneVerified) {
    throw new BadRequestException("Este teléfono ya está verificado.");
  }

  const existingPhoneUser = await userModel
    .findOne({
      $or: [
        { phone: normalizedPhone },
        { pendingPhone: normalizedPhone },
        { "profile.contacto.celular": normalizedPhone },
      ],
      phoneVerified: true,
      _id: { $ne: userId },
    })
    .lean();
  if (existingPhoneUser) {
    throw new ConflictException(
      "Este número de teléfono ya se encuentra verificado en otra cuenta.",
    );
  }

  await phoneThrottle.enforce(normalizedPhone, logger);
  await phoneThrottle.enforce(`user:${userId}`, logger);

  try {
    await birdVerifyService.createPhoneVerification(
      normalizedPhone,
      {
        userId,
        channel: "whatsapp",
      },
      {
        channels: ["whatsapp"],
        language: "es",
      },
    );
  } catch (err: unknown) {
    logger.error(
      `initiatePhoneVerification: Bird error for ${maskPhone(normalizedPhone)}: ${sanitizeForLog(
        err instanceof Error ? err.message : String(err),
      )}`,
    );
    throw new BadRequestException(
      "No se pudo enviar el código por WhatsApp. Verifica que el número sea correcto y tenga WhatsApp activo e intenta de nuevo.",
    );
  } finally {
    await phoneThrottle.record(normalizedPhone);
    await phoneThrottle.record(`user:${userId}`);
  }

  user.pendingPhone = normalizedPhone;
  user.phoneVerified = false;
  await user.save();

  logger.log(
    `Phone WhatsApp OTP sent to ${maskPhone(normalizedPhone)} for user ${userId}`,
  );
}

export async function executeVerifyPhone(
  userModel: Model<UserDocument>,
  birdVerifyService: BirdVerifyService,
  userId: string,
  phone: string,
  code: string,
  logger: Logger,
): Promise<void> {
  const normalizedPhone = normalizePhone(phone);
  const user = await userModel.findById(userId);
  if (!user) {
    throw new BadRequestException("Usuario no encontrado");
  }

  if (user.pendingPhone !== normalizedPhone && user.phone !== normalizedPhone) {
    throw new BadRequestException(
      "No hay una verificación pendiente para este teléfono.",
    );
  }

  const targetPhone = user.pendingPhone || normalizedPhone;

  let result;
  try {
    result = await birdVerifyService.checkPhoneVerification(
      targetPhone,
      code.trim(),
    );
  } catch (err: unknown) {
    logger.error(
      `verifyPhone: Bird error for ${maskPhone(targetPhone)}: ${sanitizeForLog(
        err instanceof Error ? err.message : String(err),
      )}`,
    );
    throw new BadRequestException(
      "No se pudo verificar el código. Solicita uno nuevo e intenta de nuevo.",
    );
  }

  handleVerifyCheckResult(result, async () => {
    user.pendingPhone = null;
    await user.save();
  });

  user.phone = targetPhone;
  user.phoneVerified = true;
  user.phoneVerifiedAt = new Date();
  user.pendingPhone = null;

  if (user.profile) {
    const profile = user.profile;
    const contacto = profile["contacto"] as Record<string, unknown> | undefined;
    profile["contacto"] = {
      ...contacto,
      celular: targetPhone,
    };
    user.markModified("profile");
  }

  await user.save();

  logger.log(
    `Phone ${maskPhone(targetPhone)} verified via WhatsApp for user ${userId}`,
  );
}
