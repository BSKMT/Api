import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { UsersService } from "../users/users.service";
import type { UserDocument } from "../users/schemas/user.schema";
import {
  deriveDisplayName,
  str,
  buildPrivacyFlags,
  buildOptionalSections,
  computeMembershipStatus,
  buildPrivilegedSection,
} from "./public-profile.helpers";
import {
  serializeProfileIdentifier,
  deserializeProfileIdentifier,
  buildSecureQrPayload,
  isSerializedProfileToken,
} from "./profile-token.helper";

export interface AuthenticatedRequestUser {
  userId: string;
  email: string;
  role: string;
  subrol?: string | null;
  adminPermissions?: string[];
  betterAuthId: string;
}

export function isStaffRole(requester: AuthenticatedRequestUser): boolean {
  const requesterRole = (requester.role || "").toLowerCase();
  return (
    requesterRole === "superadmin" ||
    requesterRole === "admin" ||
    requesterRole === "gestor" ||
    requesterRole === "road-captain" ||
    requesterRole === "event-manager" ||
    Boolean(requester.subrol)
  );
}

export async function validateRequesterAccess(
  requester: AuthenticatedRequestUser | undefined,
  usersService: UsersService,
): Promise<{ isStaff: boolean }> {
  if (!requester?.userId) {
    throw new UnauthorizedException(
      "Acceso restringido: Debes estar registrado e iniciar sesión en BSK para consultar perfiles de la comunidad.",
    );
  }

  const isStaff = isStaffRole(requester);

  if (!isStaff) {
    const requesterDoc = await usersService.findById(requester.userId);
    if (requesterDoc && !requesterDoc.profileCompleted) {
      throw new ForbiddenException(
        "Debes completar tu propio perfil y aceptar las políticas de tratamiento de datos antes de consultar perfiles de la comunidad.",
      );
    }
  }

  return { isStaff };
}

export function validateAntiIdorAccess(
  isSerialized: boolean,
  isStaff: boolean,
  isOwner: boolean,
  profileCompleted: boolean,
) {
  if (!isSerialized && !isStaff && !isOwner) {
    throw new ForbiddenException(
      "Acceso restringido: Para proteger la privacidad y prevenir ataques de enumeración de miembros, debes usar el enlace seguro serializado o escanear el carnet oficial con la cámara.",
    );
  }

  if (!profileCompleted && !isStaff && !isOwner) {
    throw new NotFoundException(
      "Perfil no disponible: El miembro aún no ha completado su registro oficial.",
    );
  }
}

export async function findUserByIdentifierHelper(
  identifier: string,
  usersService: UsersService,
): Promise<Awaited<ReturnType<UsersService["findById"]>>> {
  if (!identifier || identifier.length > 512) {
    return null;
  }

  if (isSerializedProfileToken(identifier)) {
    const parsed = deserializeProfileIdentifier(identifier);
    if (!parsed) return null;
    if (parsed.memberNumber) {
      return usersService.findByMemberNumber(parsed.memberNumber);
    }
    if (parsed.userId) {
      return usersService.findById(parsed.userId);
    }
    return null;
  }

  const upper = identifier.toUpperCase();
  if (upper.startsWith("BSK-")) {
    return usersService.findByMemberNumber(upper);
  }
  if (/^[0-9a-fA-F]{24}$/.test(identifier)) {
    return usersService.findById(identifier);
  }
  return null;
}

export type PublicProfileTargetUser =
  | UserDocument
  | {
      _id: unknown;
      email: string;
      profile?: Record<string, Record<string, unknown>>;
      membershipLevel?: string | null;
      membershipExpiryDate?: Date | string | null;
      membershipExpired?: boolean;
      role?: string | null;
      createdAt?: Date | string | null;
      profileCompleted?: boolean;
      settings?: Record<string, unknown>;
    };

export function buildPublicProfileResponse(
  user: PublicProfileTargetUser,
  requester: AuthenticatedRequestUser,
  isOwner: boolean,
): Record<string, unknown> {
  const membershipInfo = computeMembershipStatus(user);
  const privacy = buildPrivacyFlags(user);
  const profile = user.profile ?? {};
  const displayName = deriveDisplayName(profile, user.email);
  const membSection = profile["membresia-ecosistema"] ?? {};
  const memberNumber = str(membSection, "numeroMiembro");
  const personalSection = profile["datos-personales"];

  const serializedProfileToken = memberNumber
    ? serializeProfileIdentifier(memberNumber, String(user._id))
    : null;
  const secureQrPayload = serializedProfileToken
    ? buildSecureQrPayload(serializedProfileToken)
    : null;

  const operationalData = isOwner
    ? null
    : buildPrivilegedSection(user, requester);

  const memberSince = user.createdAt
    ? new Date(user.createdAt).toISOString()
    : null;

  return {
    displayName,
    firstName: str(personalSection, "primerNombre") || displayName,
    memberNumber,
    serializedProfileToken,
    secureQrPayload,
    membershipLevel: user.membershipLevel ?? null,
    membershipStatus: membershipInfo.status,
    isMembershipValid: membershipInfo.isValid,
    membershipExpiryFormatted: membershipInfo.expiryFormatted,
    role: isOwner ? user.role : null,
    memberSince,
    profileCompleted: user.profileCompleted ?? false,
    isOwner,
    privacy,
    isProfilePrivate: !privacy.profileVisible,
    ...buildOptionalSections(profile, privacy, isOwner),
    ...(operationalData ? { operationalData } : {}),
  };
}
