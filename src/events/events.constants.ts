export interface CoursePricing {
  amount: number;
  tier: string;
  requiresPayment: boolean;
}

export const MEMBER_LEVELS = new Set([
  "Legend",
  "Friend",
  "Rider",
  "Expert",
  "Master",
]);
