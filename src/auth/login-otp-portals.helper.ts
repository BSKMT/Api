import {
  BadRequestException,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { Model } from "mongoose";
import { UserDocument, UserRole } from "../users/schemas/user.schema";

export interface PortalUserCandidate {
  authEmail: string;
  targetEmail: string;
  isEligible: boolean;
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
      `Console login fallido: no coincide email "${normalizedEmail}" con usuario "${normalizedUsername}".`,
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
      `Superadmin login fallido: credenciales no coinciden para "${normalizedEmail}".`,
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
