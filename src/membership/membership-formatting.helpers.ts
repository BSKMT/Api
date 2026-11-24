import { ConfigService } from "@nestjs/config";
import type { EnvironmentConfig } from "../config/config.interface";
import {
  buildBoldCheckoutConfig,
  generateBoldIntegritySignatureShared,
} from "../payments/bold.helpers";

export {
  validateRenewalEligibility,
  validateNewMembershipEligibility,
  validateCampaignEnrollmentEligibility,
  computeNextInstallmentNumber,
  assertNoPendingMembershipTransaction,
} from "./membership-eligibility.helpers";

export function formatMembershipDescription(
  isRenewal: boolean,
  paymentPlan: string,
  installmentNumber: number,
  installmentTotal: number,
  paidWithCredit = false,
): string {
  const suffix = paidWithCredit ? " (pagada con crédito)" : "";
  if (isRenewal) {
    return `Renovación anticipada membresía BSK — Cuota ${installmentNumber}/${installmentTotal}${suffix}`;
  }
  if (paymentPlan === "single") {
    return `Membresía Legend BSK — Pago único anual${suffix}`;
  }
  return `Membresía Legend BSK — Cuota ${installmentNumber}/${installmentTotal}${suffix}`;
}

export function formatStoredMembershipDescription(
  paymentPlan: string,
  isRenewal: boolean,
  installmentNumber: number,
  installmentTotal: number,
): string {
  if (paymentPlan === "single") {
    return isRenewal
      ? "Renovación Membresía Legend BSK — Pago único anual"
      : "Membresía Legend BSK — Pago único anual";
  }
  const prefix = isRenewal
    ? "Renovación Membresía Legend BSK"
    : "Membresía Legend BSK";
  return `${prefix} — Cuota ${installmentNumber}/${installmentTotal}`;
}

export function generateBoldIntegritySignature(
  configService: ConfigService<EnvironmentConfig>,
  orderId: string,
  amount: number,
  currency: string,
): string {
  return generateBoldIntegritySignatureShared(
    configService,
    orderId,
    amount,
    currency,
  );
}

export function buildBoldConfig(
  configService: ConfigService<EnvironmentConfig>,
  reference: string,
  amount: number,
  description: string,
) {
  return buildBoldCheckoutConfig(configService, reference, amount, description);
}

export function buildMembershipReference(
  paymentPlan: string,
  isRenewal: boolean,
  installmentNumber: number,
  userId: string,
): string {
  const timestamp = Date.now();
  const shortUserId = userId.slice(-8);
  const planPrefix = paymentPlan === "single" ? "MEM" : "MEMI";
  const renewSuffix = isRenewal ? "R" : "";
  return `${planPrefix}${renewSuffix}-${shortUserId}-${installmentNumber}-${timestamp}`;
}

export function formatRenewalActivationMessage(
  paymentPlan: string,
  newExpiry: Date,
): string {
  return paymentPlan === "single"
    ? `Tu renovación anual fue confirmada. Tu membresía Legend está activa hasta el ${newExpiry.toLocaleDateString("es-CO")}.`
    : `Completaste las 12 cuotas de renovación. Tu membresía Legend está activa hasta el ${newExpiry.toLocaleDateString("es-CO")}.`;
}
