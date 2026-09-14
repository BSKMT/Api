import { ArphaRequestDocument } from "./schemas/arpha-request.schema";

export const LEGEND_LEVELS = new Set([
  "Legend",
  "Friend",
  "Rider",
  "Expert",
  "Master",
]);

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
