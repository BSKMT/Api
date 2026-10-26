import {
  BadRequestException,
  GoneException,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { Model } from "mongoose";
import { UserDocument, UserRole } from "../users/schemas/user.schema";
import { LoginOtpDocument } from "./schemas/login-otp.schema";
import {
  BirdVerifyService,
  type BirdCheckResult,
} from "../bird-verify/bird-verify.service";
import {
  handleBirdCheckError,
  processBirdCheckResult,
  revokeEncryptedOtpSession,
} from "./login-otp-check.helper";
import { maskEmail } from "../common/utils/log-redact.util";

export interface PortalUserCandidate {
  authEmail: string;
  targetEmail: string;
  isEligible: boolean;
}

export async function findAndValidateStandardUser(
  userModel: Model<UserDocument>,
  email: string,
): Promise<PortalUserCandidate> {
  const normalizedEmail = (email ?? "").toLowerCase().trim();
  const user = await userModel
    .findOne({
      $or: [
        { email: normalizedEmail },
        { "contractorInfo.correoInstitucional": normalizedEmail },
        { "profile.contacto.correoInstitucional": normalizedEmail },
      ],
    })
    .lean();

  const authEmail = user?.email || normalizedEmail;
  const isEligible =
    !user ||
    (user.isActive !== false && user.accountDeletionRequested !== true);

  return { authEmail, targetEmail: normalizedEmail, isEligible };
}

const GENERIC_FASCIA_ERROR =
  "Error al iniciar sesión en Fascia. Verifica tus credenciales.";
const GENERIC_CONSOLE_ERROR =
  "Error al iniciar sesión en la Consola Administrativa.";
const GENERIC_SUPERADMIN_ERROR =
  "Error al iniciar sesión como Superadministrador.";

export async function findAndValidateFasciaUser(
  userModel: Model<UserDocument>,
  username: string,
  logger: Logger,
): Promise<PortalUserCandidate> {
  const normalizedUsername = (username ?? "").toLowerCase().trim();
  if (!normalizedUsername) {
    throw new BadRequestException("El nombre de usuario es obligatorio.");
  }

  const user = await userModel.findOne({ username: normalizedUsername }).lean();
  if (!user) {
    logger.warn(
      `Fascia login fallido: usuario "${normalizedUsername}" no encontrado.`,
    );
    throw new UnauthorizedException(GENERIC_FASCIA_ERROR);
  }

  const isGestor =
    user.role === (UserRole.GESTOR as string) || Boolean(user.subrol);
  const isAdminOrSuper =
    user.role === (UserRole.ADMIN as string) ||
    user.role === (UserRole.SUPERADMIN as string);
  const isEligible =
    user.isActive !== false &&
    user.accountDeletionRequested !== true &&
    (isGestor || isAdminOrSuper);

  if (!isEligible) {
    logger.warn(
      `Fascia login candidato no elegible (se verificará contraseña primero): usuario "${normalizedUsername}"`,
    );
  }

  const targetEmail = (
    user.contractorInfo?.correoInstitucional || user.email
  ).toLowerCase();

  return { authEmail: user.email, targetEmail, isEligible };
}

export async function findAndValidateConsoleUser(
  userModel: Model<UserDocument>,
  email: string,
  username: string,
  logger: Logger,
): Promise<PortalUserCandidate> {
  const normalizedEmail = (email ?? "").toLowerCase().trim();
  const normalizedUsername = (username ?? "").toLowerCase().trim();

  if (!normalizedEmail || !normalizedUsername) {
    throw new BadRequestException(
      "Tanto el correo electrónico como el nombre de usuario son obligatorios.",
    );
  }

  const user = await userModel
    .findOne({
      username: normalizedUsername,
      $or: [
        { email: normalizedEmail },
        { "contractorInfo.correoInstitucional": normalizedEmail },
        { "profile.contacto.correoInstitucional": normalizedEmail },
      ],
    })
    .lean();

  if (!user) {
    logger.warn(
      `Console login fallido: no coincide email "${maskEmail(normalizedEmail)}" con usuario "${normalizedUsername}".`,
    );
    throw new UnauthorizedException(GENERIC_CONSOLE_ERROR);
  }

  const isEligible =
    user.isActive !== false &&
    user.accountDeletionRequested !== true &&
    (user.role === (UserRole.ADMIN as string) ||
      user.role === (UserRole.SUPERADMIN as string));

  if (!isEligible) {
    logger.warn(
      `Console login candidato no elegible (se verificará contraseña primero): usuario "${normalizedUsername}"`,
    );
  }

  return { authEmail: user.email, targetEmail: normalizedEmail, isEligible };
}

export async function findAndValidateSuperAdminUser(
  userModel: Model<UserDocument>,
  email: string,
  username: string,
  logger: Logger,
): Promise<PortalUserCandidate> {
  const normalizedEmail = (email ?? "").toLowerCase().trim();
  const normalizedUsername = (username ?? "").toLowerCase().trim();

  if (!normalizedEmail || !normalizedUsername) {
    throw new BadRequestException(
      "Tanto el correo electrónico como el nombre de usuario son obligatorios.",
    );
  }

  const user = await userModel
    .findOne({
      username: normalizedUsername,
      $or: [
        { email: normalizedEmail },
        { "contractorInfo.correoInstitucional": normalizedEmail },
        { "profile.contacto.correoInstitucional": normalizedEmail },
      ],
    })
    .lean();

  if (!user) {
    logger.warn(
      `Superadmin login fallido: credenciales no coinciden para "${maskEmail(normalizedEmail)}".`,
    );
    throw new UnauthorizedException(GENERIC_SUPERADMIN_ERROR);
  }

  const isEligible =
    user.isActive !== false &&
    user.accountDeletionRequested !== true &&
    user.role === (UserRole.SUPERADMIN as string);

  if (!isEligible) {
    logger.warn(
      `Superadmin login candidato no elegible (se verificará contraseña primero): usuario "${normalizedUsername}"`,
    );
  }

  return { authEmail: user.email, targetEmail: normalizedEmail, isEligible };
}

export async function executeVerifyOtp(params: {
  otpModel: Model<LoginOtpDocument>;
  birdVerifyService: BirdVerifyService;
  requestId: string;
  code: string;
  sessionEncKey: Buffer;
  logger: Logger;
}): Promise<{ cookies: string[]; setCookieHeaders: string[] }> {
  const {
    otpModel,
    birdVerifyService,
    requestId,
    code,
    sessionEncKey,
    logger,
  } = params;
  const otpRecord = await otpModel.findOne({ requestId, status: "pending" });
  if (!otpRecord) {
    throw new GoneException(
      "El código de verificación no existe, ya fue utilizado o ha expirado.",
    );
  }
  if (otpRecord.attempts >= 5) {
    otpRecord.status = "expired";
    await otpRecord.save();
    await revokeEncryptedOtpSession(otpRecord, sessionEncKey, logger);
    throw new GoneException(
      "Has superado el máximo de intentos permitidos. Solicita un nuevo código.",
    );
  }

  let birdResult: BirdCheckResult;
  try {
    birdResult = await birdVerifyService.checkEmailVerification(
      otpRecord.email,
      code,
    );
  } catch (err) {
    return await handleBirdCheckError(
      err,
      otpRecord,
      requestId,
      logger,
      sessionEncKey,
    );
  }
  return await processBirdCheckResult(
    otpRecord,
    requestId,
    birdResult,
    sessionEncKey,
    logger,
  );
}
