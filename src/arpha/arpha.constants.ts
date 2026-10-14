import {
  ArphaRequestDocument,
  ArphaRequestStatus,
  ARPHA_PRICING,
} from "./schemas/arpha-request.schema";

export const LEGEND_LEVELS = new Set([
  "Legend",
  "Friend",
  "Rider",
  "Expert",
  "Master",
]);

export const ACTIVE_ARPHA_STATUSES = [
  ArphaRequestStatus.PENDING,
  ArphaRequestStatus.EN_CAMINO,
  ArphaRequestStatus.EN_SITIO,
] as const;

export const TERMINAL_ARPHA_STATUSES = [
  ArphaRequestStatus.COMPLETED,
  ArphaRequestStatus.CANCELLED,
] as const;

export interface ArphaPricingResult {
  request: ArphaRequestDocument;
  pricing: {
    amount: number;
    isMember: boolean;
    requiresPayment: boolean;
  };
}

export function isLegendMember(membershipLevel: string | null): boolean {
  return membershipLevel !== null && LEGEND_LEVELS.has(membershipLevel);
}

export function calculateArphaPrice(
  requestType: string,
  membershipLevel: string | null,
): { isMember: boolean; amount: number } {
  const isMember = isLegendMember(membershipLevel);
  const amount = isMember ? 0 : (ARPHA_PRICING[requestType] ?? 15000);
  return { isMember, amount };
}
