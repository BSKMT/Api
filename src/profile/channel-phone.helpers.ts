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
      "La verificacion por SMS no esta disponible en este momento.",
    );
  }

  if (!smsService.isValidE164(phone)) {
    throw new BadRequestException(
      "El telefono debe estar en formato E.164 (ej: +573001234567)",
    );
  }

  if (!smsService.isAllowedCountryPrefix(phone)) {
    throw new BadRequestException(
      "Solo se permiten numeros telefonicos de paises autorizados (+57).",
    );
  }

  const user = await userModel.findById(userId);
  if (!user) {
    throw new BadRequestException("Usuario no encontrado");
  }

  if (user.phone === phone && user.phoneVerified) {
    throw new BadRequestException("Este telefono ya esta verificado");
  }

  const existingPhoneUser = await userModel
    .findOne({ phone, _id: { $ne: userId } })
    .lean();
  if (existingPhoneUser) {
    throw new ConflictException(
      "Este número de teléfono ya se encuentra asociado a otra cuenta.",
    );
  }

  await phoneThrottle.enforce(phone, logger);
  await phoneThrottle.enforce(`user:${userId}`, logger);

  try {
    await birdVerifyService.createPhoneVerification(phone, {
      userId,
      channel: "sms",
    });
  } catch (err: unknown) {
    logger.error(
      `initiatePhoneVerification: Bird error for ${maskPhone(phone)}: ${sanitizeForLog(
        err instanceof Error ? err.message : String(err),
      )}`,
    );
    throw new BadRequestException(
      "No se pudo enviar el codigo SMS. Verifica el numero e intenta de nuevo.",
    );
  } finally {
    await phoneThrottle.record(phone);
    await phoneThrottle.record(`user:${userId}`);
  }

  user.pendingPhone = phone;
  user.phoneVerified = false;
  await user.save();

  logger.log(`Phone OTP sent to ${maskPhone(phone)} for user ${userId}`);
}

export async function executeVerifyPhone(
  userModel: Model<UserDocument>,
  birdVerifyService: BirdVerifyService,
  userId: string,
  phone: string,
  code: string,
  logger: Logger,
): Promise<void> {
  const user = await userModel.findById(userId);
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
    result = await birdVerifyService.checkPhoneVerification(phone, code);
  } catch (err: unknown) {
    logger.error(
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

  logger.log(`Phone ${maskPhone(phone)} verified for user ${userId}`);
}
