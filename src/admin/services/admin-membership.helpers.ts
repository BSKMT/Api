import { MEMBERSHIP_DURATION_MS } from "../../membership/membership.constants";

export function calculateActivationExpiry(
  currentExpiryDate?: Date | string | null,
): {
  baseDate: Date;
  expiry: Date;
} {
  const now = new Date();
  const baseDate =
    currentExpiryDate && new Date(currentExpiryDate) > now
      ? new Date(currentExpiryDate)
      : now;
  const expiry = new Date(baseDate.getTime() + MEMBERSHIP_DURATION_MS);
  return { baseDate, expiry };
}

export function calculateExtensionExpiry(
  currentExpiryDate?: Date | string | null,
  unit = "month",
  amount = 1,
  baseDateStr?: string,
): Date {
  const now = new Date();
  let baseDate: Date;
  if (baseDateStr && currentExpiryDate) {
    baseDate = new Date(baseDateStr);
  } else if (currentExpiryDate) {
    baseDate = new Date(currentExpiryDate);
  } else {
    baseDate = now;
  }
  const start = baseDate > now ? baseDate : now;

  const expiry = new Date(start);
  const qty = Math.max(1, Math.floor(amount));
  const normalizedUnit = unit.endsWith("s") ? unit : `${unit}s`;
  switch (normalizedUnit) {
    case "days":
      expiry.setDate(expiry.getDate() + qty);
      break;
    case "months":
      expiry.setMonth(expiry.getMonth() + qty);
      break;
    case "years":
      expiry.setFullYear(expiry.getFullYear() + qty);
      break;
  }

  return expiry;
}
