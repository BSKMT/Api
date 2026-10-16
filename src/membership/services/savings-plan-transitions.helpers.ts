import { Model } from "mongoose";
import {
  SavingsPlanDocument,
  SavingsPlanStatus,
} from "../schemas/savings-plan.schema";
import { UserDocument, UserRole } from "../../users/schemas/user.schema";

export interface PlanTransitionCampaign {
  renewalStartDate?: string | Date;
  startDate?: string | Date;
  renewalEndDate?: string | Date;
  endDate?: string | Date;
}

export async function evaluateSavingsPlanTransitions(
  plan: SavingsPlanDocument,
  campaign: PlanTransitionCampaign | undefined,
  userModel: Model<UserDocument>,
  userId: string,
  nowMs: number,
): Promise<{
  currentStatus: SavingsPlanStatus;
  gracePeriod1ExpiresAt: Date | undefined;
}> {
  const renewalEnd = campaign?.renewalEndDate || campaign?.endDate;
  const renewalEndMs = renewalEnd ? new Date(renewalEnd).getTime() : null;

  let currentStatus = plan.status;
  let gracePeriod1ExpiresAt = plan.gracePeriod1ExpiresAt ?? undefined;

  if (
    plan.isRenewal &&
    renewalEndMs &&
    nowMs > renewalEndMs &&
    plan.installmentsPaid < plan.targetInstallments &&
    currentStatus === SavingsPlanStatus.ACTIVE
  ) {
    const g1 = new Date(renewalEndMs + 30 * 24 * 60 * 60 * 1000);
    plan.gracePeriod1ExpiresAt = g1;
    gracePeriod1ExpiresAt = g1;

    if (nowMs <= g1.getTime()) {
      plan.status = SavingsPlanStatus.GRACE_PERIOD_1;
      currentStatus = SavingsPlanStatus.GRACE_PERIOD_1;
    } else if (!plan.gracePeriod2ExpiresAt) {
      plan.status = SavingsPlanStatus.LAPSED_TEMPORARY;
      currentStatus = SavingsPlanStatus.LAPSED_TEMPORARY;
    }
    await plan.save();
  }

  if (
    currentStatus === SavingsPlanStatus.GRACE_PERIOD_2 &&
    plan.gracePeriod2ExpiresAt &&
    nowMs > new Date(plan.gracePeriod2ExpiresAt).getTime() &&
    plan.installmentsPaid < plan.targetInstallments
  ) {
    plan.status = SavingsPlanStatus.LAPSED_TEMPORARY;
    currentStatus = SavingsPlanStatus.LAPSED_TEMPORARY;
    await plan.save();

    await userModel.updateOne(
      { _id: userId, role: UserRole.MEMBER },
      { $set: { role: UserRole.USER } },
    );
  }

  return { currentStatus, gracePeriod1ExpiresAt };
}

export interface PlanActionParams {
  plan: SavingsPlanDocument;
  currentStatus: SavingsPlanStatus;
  gracePeriod1ExpiresAt: Date | undefined;
  renewalStartMs: number | null;
  renewalEndMs: number | null;
  nowMs: number;
  remainingInstallments: number;
  hasActiveRefund: boolean;
}

export function computeSavingsPlanActionFlags(params: PlanActionParams) {
  const {
    plan,
    currentStatus,
    gracePeriod1ExpiresAt,
    renewalStartMs,
    renewalEndMs,
    nowMs,
    remainingInstallments,
    hasActiveRefund,
  } = params;

  const isInGrace1 =
    currentStatus === SavingsPlanStatus.GRACE_PERIOD_1 &&
    !!gracePeriod1ExpiresAt &&
    nowMs <= new Date(gracePeriod1ExpiresAt).getTime();

  const isInGrace2 =
    currentStatus === SavingsPlanStatus.GRACE_PERIOD_2 &&
    !!plan.gracePeriod2ExpiresAt &&
    nowMs <= new Date(plan.gracePeriod2ExpiresAt).getTime();

  const isInGrace = isInGrace1 || isInGrace2;
  const canPaySingleInstallment =
    currentStatus === SavingsPlanStatus.ACTIVE && !isInGrace;
  const canCompleteBalance =
    (currentStatus === SavingsPlanStatus.ACTIVE || isInGrace) &&
    remainingInstallments > 0;

  const canRequestExtension =
    (currentStatus === SavingsPlanStatus.GRACE_PERIOD_1 ||
      (renewalEndMs !== null &&
        nowMs > renewalEndMs &&
        plan.installmentsPaid < 12)) &&
    (!plan.extensionRequest ||
      plan.extensionRequest.status === "none" ||
      plan.extensionRequest.status === "rejected") &&
    currentStatus !== SavingsPlanStatus.GRACE_PERIOD_2;

  const canRequestRefund =
    (currentStatus === SavingsPlanStatus.LAPSED_TEMPORARY ||
      currentStatus === SavingsPlanStatus.GRACE_PERIOD_1 ||
      currentStatus === SavingsPlanStatus.GRACE_PERIOD_2) &&
    plan.totalAmountSaved > 0 &&
    !hasActiveRefund;

  const isRenewalWindowOpen = Boolean(
    renewalStartMs &&
    renewalEndMs &&
    nowMs >= renewalStartMs &&
    nowMs <= renewalEndMs,
  );

  const canReinstate = Boolean(
    (currentStatus === SavingsPlanStatus.LAPSED_TEMPORARY ||
      currentStatus === SavingsPlanStatus.ACTIVE) &&
    plan.installmentsPaid >= 12 &&
    isRenewalWindowOpen,
  );

  return {
    isInGrace,
    canPaySingleInstallment,
    canCompleteBalance,
    canRequestExtension,
    canRequestRefund,
    canReinstate,
    isRenewalWindowOpen,
  };
}
