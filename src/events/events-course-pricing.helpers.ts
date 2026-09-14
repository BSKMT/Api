import { CoursePricing, MEMBER_LEVELS } from "./events.constants";

export interface CoursePricingInput {
  nonMemberPrice: number | null;
  format: string;
  membersFree: boolean;
  memberSemipresencialDiscount: number | null;
  memberPresencialDiscount: number | null;
}

export function calculateCoursePricing(
  course: CoursePricingInput,
  membershipLevel: string | null,
): CoursePricing {
  const isMember = MEMBER_LEVELS.has(membershipLevel ?? "");
  const basePrice = course.nonMemberPrice ?? 0;

  if (!isMember) {
    return {
      amount: basePrice,
      tier: "course-non-member",
      requiresPayment: basePrice > 0,
    };
  }

  const virtualPricing: CoursePricing = {
    amount: 0,
    tier: "course-member-virtual",
    requiresPayment: false,
  };

  switch (course.format) {
    case "virtual":
      return virtualPricing;
    case "semipresencial":
      return {
        amount: Math.round(
          basePrice * ((course.memberSemipresencialDiscount ?? 25) / 100),
        ),
        tier: "course-member-semipresencial",
        requiresPayment: basePrice > 0,
      };
    case "presencial":
      return {
        amount: Math.round(
          basePrice * (1 - (course.memberPresencialDiscount ?? 20) / 100),
        ),
        tier: "course-member-presencial",
        requiresPayment: basePrice > 0,
      };
    default:
      return virtualPricing;
  }
}
