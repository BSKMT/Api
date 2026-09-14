import * as crypto from "node:crypto";
import { BadRequestException, ConflictException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Model } from "mongoose";
import type { EnvironmentConfig } from "../config/config.interface";
import { UserRole } from "../users/schemas/user.schema";
import { MembershipTransactionDocument } from "./schemas/membership-transaction.schema";
import { INSTALLMENTS_TOTAL } from "./membership.constants";

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
  const secretKey = configService.get<string>("BOLD_SECRET_KEY", {
    infer: true,
  });
  if (!secretKey) {
    throw new BadRequestException("BOLD_SECRET_KEY not configured");
  }
  const concatenated = `${orderId}${amount}${currency}${secretKey}`;
  return crypto.createHash("sha256").update(concatenated).digest("hex");
}

export function buildBoldConfig(
  configService: ConfigService<EnvironmentConfig>,
  reference: string,
  amount: number,
  description: string,
) {
  const boldPublicKey =
    configService.get<string>("BOLD_PUBLIC_KEY", { infer: true }) ?? "";
  const boldEnvironment =
    configService.get<string>("BOLD_ENVIRONMENT", { infer: true }) ?? "sandbox";
  const boldBaseUrl =
    boldEnvironment === "production"
      ? "https://payments.api.bold.co"
      : "https://payments-api-test.bold.co";
  return {
    publicKey: boldPublicKey,
    environment: boldEnvironment,
    baseUrl: boldBaseUrl,
    referenceId: reference,
    description,
    amount,
    currency: "COP",
    integritySignature: generateBoldIntegritySignature(
      configService,
      reference,
      amount,
      "COP",
    ),
  };
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

export function validateRenewalEligibility(
  userRole: string,
  isInGracePeriod: boolean,
  membershipExpired: boolean,
): void {
  const memberRole = UserRole.MEMBER as string;
  if (userRole !== memberRole) {
    throw new BadRequestException(
      "Solo los miembros activos pueden renovar anticipadamente",
    );
  }
  if (membershipExpired) {
    throw new BadRequestException(
      isInGracePeriod
        ? "Tu membresía expiró pero estás en periodo de gracia. Compra una nueva membresía, no una renovación."
        : "Tu membresía ya expiró. Debe comprar una nueva membresía, no una renovación.",
    );
  }
}

export function validateNewMembershipEligibility(
  userRole: string,
  membershipExpired: boolean,
): void {
  const memberRole = UserRole.MEMBER as string;
  if (userRole === memberRole && !membershipExpired) {
    throw new BadRequestException(
      "Ya tienes una membresía activa. Usa la opción de renovación anticipada.",
    );
  }
}

export async function computeNextInstallmentNumber(
  transactionModel: Model<MembershipTransactionDocument>,
  userId: string,
  isRenewal: boolean,
): Promise<number> {
  const lastTx = await transactionModel
    .findOne({
      userId,
      paymentPlan: "installment",
      isRenewal,
      status: "APPROVED",
    })
    .sort({ installmentNumber: -1 });

  if (!lastTx) return 1;
  if (lastTx.installmentNumber >= INSTALLMENTS_TOTAL) {
    throw new ConflictException(
      "Ya completaste las 12 cuotas. Tu membresía debería estar activa.",
    );
  }
  return lastTx.installmentNumber + 1;
}

export async function assertNoPendingMembershipTransaction(
  transactionModel: Model<MembershipTransactionDocument>,
  userId: string,
  paymentPlan: string,
  isRenewal: boolean,
  installmentNumber: number,
): Promise<void> {
  if (paymentPlan === "installment") {
    const pendingForSameKey = await transactionModel.findOne({
      userId,
      paymentPlan: "installment",
      isRenewal,
      installmentNumber,
      status: "PENDING",
    });
    if (pendingForSameKey) {
      throw new ConflictException(
        `Ya tienes un pago pendiente (${pendingForSameKey.reference}). Continúa o cancélala antes de iniciar uno nuevo.`,
      );
    }
  } else if (paymentPlan === "single") {
    const pendingSingle = await transactionModel.findOne({
      userId,
      paymentPlan: "single",
      isRenewal,
      status: "PENDING",
    });
    if (pendingSingle) {
      throw new ConflictException(
        `Ya tienes un pago pendiente de membresía (${pendingSingle.reference}). Continúa o cancélalo antes de iniciar uno nuevo.`,
      );
    }
  }
}
