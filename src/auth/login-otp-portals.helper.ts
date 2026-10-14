import {
  BadRequestException,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { Model } from "mongoose";
import { UserDocument, UserRole } from "../users/schemas/user.schema";

export async function findAndValidateFasciaUser(
  userModel: Model<UserDocument>,
  username: string,
  logger: Logger,
): Promise<{ authEmail: string; targetEmail: string }> {
  const normalizedUsername = (username ?? "").toLowerCase().trim();
  if (!normalizedUsername) {
    throw new BadRequestException("El nombre de usuario es obligatorio.");
  }

  const user = await userModel.findOne({ username: normalizedUsername }).lean();
  if (!user) {
    logger.warn(
      `Fascia login fallido: usuario "${normalizedUsername}" no encontrado.`,
    );
    throw new UnauthorizedException(
      "Credenciales inválidas. Verifica tu usuario y contraseña.",
    );
  }

  if (user.isActive === false) {
    throw new UnauthorizedException(
      "Tu cuenta de colaborador se encuentra inactiva. Contacta al área de talento humano.",
    );
  }

  if (user.accountDeletionRequested === true) {
    throw new UnauthorizedException(
      "Esta cuenta está en proceso de eliminación.",
    );
  }

  const isGestor =
    user.role === (UserRole.GESTOR as string) || Boolean(user.subrol);
  const isAdminOrSuper =
    user.role === (UserRole.ADMIN as string) ||
    user.role === (UserRole.SUPERADMIN as string);

  if (!isGestor && !isAdminOrSuper) {
    logger.warn(
      `Fascia login bloqueado: usuario "${normalizedUsername}" (${user.email}) no tiene rol de gestor.`,
    );
    throw new UnauthorizedException(
      "Acceso restringido: Esta cuenta no posee rol de Gestor (Campo u Oficina) asignado para panel.bskmt.com.",
    );
  }

  const targetEmail = (
    user.contractorInfo?.correoInstitucional || user.email
  ).toLowerCase();

  return { authEmail: user.email, targetEmail };
}

export async function findAndValidateConsoleUser(
  userModel: Model<UserDocument>,
  email: string,
  username: string,
  logger: Logger,
): Promise<{ authEmail: string; targetEmail: string }> {
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
    throw new UnauthorizedException(
      "Credenciales administrativas inválidas. Verifica tu correo, usuario y contraseña.",
    );
  }

  if (user.isActive === false) {
    throw new UnauthorizedException(
      "Cuenta administrativa inactiva. Contacta a un Superadministrador.",
    );
  }

  if (user.accountDeletionRequested === true) {
    throw new UnauthorizedException(
      "Esta cuenta está en proceso de eliminación.",
    );
  }

  if (
    user.role !== (UserRole.ADMIN as string) &&
    user.role !== (UserRole.SUPERADMIN as string)
  ) {
    logger.warn(
      `Console login bloqueado: usuario "${normalizedUsername}" tiene rol "${user.role}" (requiere admin o superadmin).`,
    );
    throw new UnauthorizedException(
      "Acceso restringido: Esta cuenta no posee privilegios administrativos ejecutivos.",
    );
  }

  return { authEmail: user.email, targetEmail: normalizedEmail };
}

export async function findAndValidateSuperAdminUser(
  userModel: Model<UserDocument>,
  email: string,
  username: string,
  logger: Logger,
): Promise<{ authEmail: string; targetEmail: string }> {
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
    throw new UnauthorizedException(
      "Credenciales de superadministrador inválidas.",
    );
  }

  if (user.isActive === false) {
    throw new UnauthorizedException("Cuenta de superadministrador inactiva.");
  }

  if (user.role !== (UserRole.SUPERADMIN as string)) {
    logger.warn(
      `Superadmin login denegado: usuario "${normalizedUsername}" no tiene rol 'superadmin'.`,
    );
    throw new UnauthorizedException(
      "Acceso denegado: Esta cuenta no posee privilegios de Superadministrador (Owner).",
    );
  }

  return { authEmail: user.email, targetEmail: normalizedEmail };
}
