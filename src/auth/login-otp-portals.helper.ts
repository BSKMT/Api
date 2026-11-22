import { BadRequestException, GoneException, Logger } from "@nestjs/common";
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

async function findUserByPrimaryOrInstitutionalEmail(
  userModel: Model<UserDocument>,
  normalizedEmail: string,
  username?: string,
) {
  const baseFilter = username ? { username } : {};
  const byPrimary = await userModel
    .findOne({ ...baseFilter, email: normalizedEmail })
    .lean();
  if (byPrimary) return byPrimary;
  return userModel
    .findOne({
      ...baseFilter,
      "contractorInfo.correoInstitucional": normalizedEmail,
    })
    .lean();
}

export async function findAndValidateStandardUser(
  userModel: Model<UserDocument>,
  email: string,
): Promise<PortalUserCandidate> {
  const normalizedEmail = (email ?? "").toLowerCase().trim();
  const user = await findUserByPrimaryOrInstitutionalEmail(
    userModel,
    normalizedEmail,
  );

  const authEmail = user?.email || normalizedEmail;
  // Las cuentas de staff/admin/superadmin que también son miembros del club pueden
  // iniciar sesión en el portal estándar (New-panel / New-App), pero su sesión queda
  // estrictamente acotada a authPortal="standard" y es rechazada por GestionGuard,
  // RolesGuard y SuperAdminGuard (aislamiento 3FA/4FA por portal).
  const isEligible =
    !user ||
    (user.isActive !== false && user.accountDeletionRequested !== true);

  return { authEmail, targetEmail: normalizedEmail, isEligible };
}

const INVALID_CANDIDATE_EMAIL = "nonexistent-user@invalid.bskmt.local";

function maskUsername(username: string): string {
  const clean = username.trim();
  if (clean.length <= 2) return "**";
  return `${clean.slice(0, 2)}***`;
}

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
      `Fascia login candidato no encontrado (se ejecutará verificación constante): usuario "${maskUsername(normalizedUsername)}".`,
    );
    return {
      authEmail: INVALID_CANDIDATE_EMAIL,
      targetEmail: INVALID_CANDIDATE_EMAIL,
      isEligible: false,
    };
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
      `Fascia login candidato no elegible (se verificará contraseña primero): usuario "${maskUsername(normalizedUsername)}"`,
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

  const user = await findUserByPrimaryOrInstitutionalEmail(
    userModel,
    normalizedEmail,
    normalizedUsername,
  );

  if (!user) {
    logger.warn(
      `Console login candidato no encontrado (se ejecutará verificación constante): email "${maskEmail(normalizedEmail)}" usuario "${maskUsername(normalizedUsername)}".`,
    );
    return {
      authEmail: INVALID_CANDIDATE_EMAIL,
      targetEmail: normalizedEmail,
      isEligible: false,
    };
  }

  const isEligible =
    user.isActive !== false &&
    user.accountDeletionRequested !== true &&
    (user.role === (UserRole.ADMIN as string) ||
      user.role === (UserRole.SUPERADMIN as string));

  if (!isEligible) {
    logger.warn(
      `Console login candidato no elegible (se verificará contraseña primero): usuario "${maskUsername(normalizedUsername)}"`,
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

  const user = await findUserByPrimaryOrInstitutionalEmail(
    userModel,
    normalizedEmail,
    normalizedUsername,
  );

  if (!user) {
    logger.warn(
      `Superadmin login candidato no encontrado (se ejecutará verificación constante): "${maskEmail(normalizedEmail)}".`,
    );
    return {
      authEmail: INVALID_CANDIDATE_EMAIL,
      targetEmail: normalizedEmail,
      isEligible: false,
    };
  }

  const isEligible =
    user.isActive !== false &&
    user.accountDeletionRequested !== true &&
    user.role === (UserRole.SUPERADMIN as string);

  if (!isEligible) {
    logger.warn(
      `Superadmin login candidato no elegible (se verificará contraseña primero): usuario "${maskUsername(normalizedUsername)}"`,
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
  const otpRecord = await otpModel.findOneAndUpdate(
    {
      requestId,
      status: "pending",
      attempts: { $lt: 5 },
      expiresAt: { $gt: new Date() },
    },
    { $inc: { attempts: 1 } },
    { new: true },
  );
  if (!otpRecord) {
    const existing = await otpModel.findOne({ requestId });
    if (existing && (existing.attempts >= 5 || existing.status === "expired")) {
      if (existing.status !== "expired") {
        existing.status = "expired";
        await existing.save();
      }
      await revokeEncryptedOtpSession(existing, sessionEncKey, logger);
      throw new GoneException(
        "Has superado el máximo de intentos permitidos. Solicita un nuevo código.",
      );
    }
    throw new GoneException(
      "El código de verificación no existe, ya fue utilizado o ha expirado.",
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
