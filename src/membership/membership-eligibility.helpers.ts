import { BadRequestException, ConflictException } from "@nestjs/common";
import { Model } from "mongoose";
import { UserRole } from "../users/schemas/user.schema";
import { MembershipTransactionDocument } from "./schemas/membership-transaction.schema";
import { INSTALLMENTS_TOTAL } from "./membership.constants";

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

export function validateCampaignEnrollmentEligibility(
  campaignConfig?: {
    startDate?: string;
    endDate?: string;
    renewalStartDate?: string;
    renewalEndDate?: string;
    newMemberStartDate?: string;
    isActive?: boolean;
    lotMaxCapacity?: number;
  },
  seasonYear?: number,
  now: Date = new Date(),
  isRenewal = false,
): void {
  if (!campaignConfig) return;

  if (campaignConfig.isActive === false) {
    throw new BadRequestException(
      `La ventana de inscripciones oficiales para la temporada ${seasonYear ?? 2027} se encuentra pausada o no está activa.`,
    );
  }

  const nowMs = now.getTime();
  const year = seasonYear ?? 2027;

  if (isRenewal) {
    const rawStart =
      campaignConfig.renewalStartDate || campaignConfig.startDate;
    const rawEnd = campaignConfig.renewalEndDate || campaignConfig.endDate;

    if (rawStart) {
      const startMs = new Date(rawStart).getTime();
      if (nowMs < startMs) {
        const startFmt = new Date(rawStart).toLocaleDateString("es-CO", {
          timeZone: "America/Bogota",
          year: "numeric",
          month: "long",
          day: "numeric",
        });
        throw new BadRequestException(
          `Las inscripciones de renovación preferencial para miembros de la temporada ${year} aún no han abierto. Fecha de apertura oficial: ${startFmt}.`,
        );
      }
    }

    if (rawEnd) {
      const endMs = new Date(rawEnd).getTime();
      if (nowMs > endMs) {
        throw new BadRequestException(
          `El periodo de renovaciones para la temporada ${year} ha finalizado.`,
        );
      }
    }
  } else {
    const rawStart =
      campaignConfig.newMemberStartDate || campaignConfig.startDate;
    const rawEnd = campaignConfig.endDate;

    if (rawStart) {
      const startMs = new Date(rawStart).getTime();
      if (nowMs < startMs) {
        const startFmt = new Date(rawStart).toLocaleDateString("es-CO", {
          timeZone: "America/Bogota",
          year: "numeric",
          month: "long",
          day: "numeric",
        });
        throw new BadRequestException(
          `Las inscripciones para nuevos ingresos de la temporada ${year} aún no han abierto. Fecha de apertura general: ${startFmt}. Actualmente se encuentra activa la fase de renovación exclusiva para miembros antiguos.`,
        );
      }
    }

    if (rawEnd) {
      const endMs = new Date(rawEnd).getTime();
      if (nowMs > endMs) {
        throw new BadRequestException(
          `El periodo de inscripciones oficiales para la temporada ${year} ha finalizado.`,
        );
      }
    }
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
