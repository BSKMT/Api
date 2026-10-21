import { UserRole } from "../users/schemas/user.schema";
import type { User, UserDocument } from "../users/schemas/user.schema";
import type { BirdContactCustomData } from "./bird-contact.interfaces";

export const DEFAULT_BIRD_AUDIENCES = {
  USERS: "adn_01m10ftkpeeyz9hmdk1ahy3s1h", // usuarios bskmt
  MEMBERS: "adn_01m10fv8axe26v3v646cmwj63s", // miembros bskmt
  EMPLOYEES: "adn_01m5g854wbe05snnxfb17zct16", // empleados bskmt
  ADMINS: "adn_01m10fw0chfqfseb3c4260yghq", // administradores bskmt
} as const;

export interface BirdAudienceConfig {
  usersId: string;
  membersId: string;
  employeesId: string;
  adminsId: string;
}

export function parseDateHelper(val: unknown): Date | null {
  if (val instanceof Date) return val;
  if (typeof val === "string" && val.trim()) {
    const d = new Date(val);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function calculateMembershipStatusHelper(
  role: UserRole,
  membershipLevel: string,
  membershipExpired: boolean,
  expiryDate: Date | null,
  graceDate: Date | null,
): "active" | "grace_period" | "expired" | "none" {
  if (role !== UserRole.MEMBER && !membershipLevel) {
    return "none";
  }
  const now = new Date();
  if (graceDate && graceDate > now) {
    return "grace_period";
  }
  if (membershipExpired || (expiryDate && expiryDate < now)) {
    return "expired";
  }
  return "active";
}

export function resolveTargetAudienceHelper(
  audiences: BirdAudienceConfig,
  role: UserRole,
  subrol: string,
  hasContractorInfo: boolean,
  isMember: boolean,
): { targetAudienceId: string; removeAudienceIds: string[] } {
  if (role === UserRole.SUPERADMIN || role === UserRole.ADMIN) {
    return {
      targetAudienceId: audiences.adminsId,
      removeAudienceIds: [audiences.usersId],
    };
  }
  if (
    hasContractorInfo ||
    Boolean(subrol) ||
    role === UserRole.GESTOR ||
    role === UserRole.ROAD_CAPTAIN ||
    role === UserRole.EVENT_MANAGER ||
    role === UserRole.MODERATOR
  ) {
    return {
      targetAudienceId: audiences.employeesId,
      removeAudienceIds: [audiences.usersId],
    };
  }
  if (isMember) {
    return {
      targetAudienceId: audiences.membersId,
      removeAudienceIds: [audiences.usersId],
    };
  }
  return {
    targetAudienceId: audiences.usersId,
    removeAudienceIds: [audiences.membersId],
  };
}

export function extractMemberNumberHelper(
  user: Partial<UserDocument | User | Record<string, unknown>>,
): string {
  const rawMemberNumber =
    (user.profile as Record<string, Record<string, unknown>>)?.[
      "membresia-ecosistema"
    ]?.["numeroMiembro"] ?? (user as Record<string, unknown>)["numeroMiembro"];

  if (typeof rawMemberNumber === "string") {
    return rawMemberNumber.trim();
  }
  if (typeof rawMemberNumber === "number") {
    return String(rawMemberNumber);
  }
  return "";
}

export function classifyUserAudiencesHelper(
  audiences: BirdAudienceConfig,
  user: Partial<UserDocument | User | Record<string, unknown>>,
) {
  const rawRole = user.role;
  const userRoleStr = typeof rawRole === "string" ? rawRole : "";
  const role: UserRole = Object.values(UserRole).includes(
    userRoleStr as UserRole,
  )
    ? (userRoleStr as UserRole)
    : UserRole.USER;
  const subrol = typeof user.subrol === "string" ? user.subrol : "";
  const hasContractorInfo = Boolean(user.contractorInfo);
  const membershipLevel =
    typeof user.membershipLevel === "string" ? user.membershipLevel : "";

  const expiryDate = parseDateHelper(user.membershipExpiryDate);
  const graceDate = parseDateHelper(user.membershipGracePeriodEnd);
  const membershipExpired = Boolean(user.membershipExpired);

  const membershipStatus = calculateMembershipStatusHelper(
    role,
    membershipLevel,
    membershipExpired,
    expiryDate,
    graceDate,
  );

  const isMember =
    membershipStatus === "active" || membershipStatus === "grace_period";

  const { targetAudienceId, removeAudienceIds } = resolveTargetAudienceHelper(
    audiences,
    role,
    subrol,
    hasContractorInfo,
    isMember,
  );

  const memberNumber = extractMemberNumberHelper(user);

  const customData: BirdContactCustomData = {
    role,
    subrol: subrol || "",
    membership: isMember,
    membership_status: membershipStatus,
    membership_level: membershipLevel || "",
    membership_expiry: expiryDate ? expiryDate.toISOString().split("T")[0] : "",
    member_number: memberNumber,
  };

  return {
    targetAudienceId,
    removeAudienceIds,
    isMember,
    membershipStatus,
    customData,
  };
}
