import { UserRole } from "../../users/schemas/user.schema";

export interface MembershipEligibilityTarget {
  role?: string | null;
  membershipLevel?: string | null;
  membershipExpired?: boolean | null;
  membershipExpiryDate?: Date | string | null;
}

/**
 * Authoritative active-membership check (OWASP A01 / M-01):
 * Verifies role === MEMBER, non-empty membershipLevel, membershipExpired !== true,
 * and membershipExpiryDate strictly in the future.
 */
export function isActiveMember(
  user?: MembershipEligibilityTarget | null,
  now: Date = new Date(),
): boolean {
  if (!user) return false;
  const role = (user.role ?? "").toLowerCase();
  if (role !== UserRole.MEMBER) return false;
  if (!user.membershipLevel) return false;
  if (user.membershipExpired === true) return false;
  if (!user.membershipExpiryDate) return false;
  const expiry = new Date(user.membershipExpiryDate);
  if (Number.isNaN(expiry.getTime())) return false;
  return expiry.getTime() > now.getTime();
}

export function isActiveLegendMember(
  user?: MembershipEligibilityTarget | null,
  now: Date = new Date(),
): boolean {
  return isActiveMember(user, now) && user?.membershipLevel === "Legend";
}
