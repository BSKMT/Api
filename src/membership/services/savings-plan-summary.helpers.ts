import { NotFoundException, BadRequestException } from "@nestjs/common";
import { Model } from "mongoose";
import {
  SavingsPlanDocument,
  SavingsPlanStatus,
} from "../schemas/savings-plan.schema";
import {
  SavingsRefundRequestDocument,
  SavingsRefundStatus,
} from "../schemas/savings-refund-request.schema";
import { UserDocument, UserRole } from "../../users/schemas/user.schema";
import { UsersService } from "../../users/users.service";
import { SystemPricingConfigService } from "../../admin/services/system-pricing-config.service";
import {
  INSTALLMENTS_TOTAL,
  INSTALLMENT_AMOUNT,
} from "../membership.constants";
import {
  evaluateSavingsPlanTransitions,
  computeSavingsPlanActionFlags,
} from "./savings-plan-transitions.helpers";

export async function getOrCreateUserSavingsPlan(
  savingsPlanModel: Model<SavingsPlanDocument>,
  usersService: UsersService,
  pricingConfigService: SystemPricingConfigService,
  userId: string,
): Promise<SavingsPlanDocument> {
  const pricingConfig = await pricingConfigService.getConfig();
  const seasonYear = pricingConfig.seasonYear ?? 2027;
  const user = await usersService.findById(userId);
  if (!user) throw new NotFoundException("Usuario no encontrado.");

  let plan = await savingsPlanModel.findOne({ userId, seasonYear });
  if (!plan) {
    const isMember = user.role === (UserRole.MEMBER as string);
    const installmentsPaid = isMember
      ? (user.renewalInstallmentsPaid ?? 0)
      : (user.installmentsPaid ?? 0);
    const instAmount =
      pricingConfig.membership?.installmentAmount ?? INSTALLMENT_AMOUNT;

    plan = await savingsPlanModel.create({
      userId,
      seasonYear,
      isRenewal: isMember,
      targetInstallments: INSTALLMENTS_TOTAL,
      installmentsPaid,
      totalAmountSaved: installmentsPaid * instAmount,
      installmentAmount: instAmount,
      status: SavingsPlanStatus.ACTIVE,
    });
  }

  return plan;
}

export async function computeSavingsPlanSummary(
  savingsPlanModel: Model<SavingsPlanDocument>,
  refundRequestModel: Model<SavingsRefundRequestDocument>,
  userModel: Model<UserDocument>,
  usersService: UsersService,
  pricingConfigService: SystemPricingConfigService,
  userId: string,
) {
  const plan = await getOrCreateUserSavingsPlan(
    savingsPlanModel,
    usersService,
    pricingConfigService,
    userId,
  );
  const pricingConfig = await pricingConfigService.getConfig();
  const campaign = pricingConfig.campaign;
  const now = new Date();
  const nowMs = now.getTime();

  const renewalEnd = campaign?.renewalEndDate || campaign?.endDate;
  const renewalEndMs = renewalEnd ? new Date(renewalEnd).getTime() : null;
  const renewalStart = campaign?.renewalStartDate || campaign?.startDate;
  const renewalStartMs = renewalStart ? new Date(renewalStart).getTime() : null;

  const { currentStatus, gracePeriod1ExpiresAt } =
    await evaluateSavingsPlanTransitions(
      plan,
      campaign,
      userModel,
      userId,
      nowMs,
    );

  const remainingInstallments = Math.max(
    0,
    plan.targetInstallments - plan.installmentsPaid,
  );
  const remainingBalance = remainingInstallments * plan.installmentAmount;
  const progressPercent = Math.min(
    100,
    Math.round((plan.installmentsPaid / plan.targetInstallments) * 100),
  );

  const activeRefund = await refundRequestModel
    .findOne({
      userId,
      status: {
        $nin: [
          SavingsRefundStatus.APPROVED,
          SavingsRefundStatus.LEGAL_RESOLVED_REJECTED,
        ],
      },
    })
    .sort({ createdAt: -1 });

  const actions = computeSavingsPlanActionFlags({
    plan,
    currentStatus,
    gracePeriod1ExpiresAt,
    renewalStartMs,
    renewalEndMs,
    nowMs,
    remainingInstallments,
    hasActiveRefund: Boolean(activeRefund),
  });

  return {
    seasonYear: plan.seasonYear,
    isRenewal: plan.isRenewal,
    targetInstallments: plan.targetInstallments,
    installmentsPaid: plan.installmentsPaid,
    totalAmountSaved: plan.totalAmountSaved,
    installmentAmount: plan.installmentAmount,
    remainingInstallments,
    remainingBalance,
    progressPercent,
    status: currentStatus,
    excessInstallments: plan.excessInstallments,
    isInGracePeriod: actions.isInGrace,
    gracePeriod1ExpiresAt: plan.gracePeriod1ExpiresAt,
    gracePeriod2ExpiresAt: plan.gracePeriod2ExpiresAt,
    canPaySingleInstallment: actions.canPaySingleInstallment,
    canCompleteBalance: actions.canCompleteBalance,
    canRequestExtension: actions.canRequestExtension,
    canRequestRefund: actions.canRequestRefund,
    canReinstate: actions.canReinstate,
    isRenewalWindowOpen: actions.isRenewalWindowOpen,
    extensionRequest: plan.extensionRequest,
    activeRefund,
  };
}

export async function computeCompleteBalanceContext(
  savingsPlanModel: Model<SavingsPlanDocument>,
  refundRequestModel: Model<SavingsRefundRequestDocument>,
  userModel: Model<UserDocument>,
  usersService: UsersService,
  pricingConfigService: SystemPricingConfigService,
  userId: string,
) {
  const summary = await computeSavingsPlanSummary(
    savingsPlanModel,
    refundRequestModel,
    userModel,
    usersService,
    pricingConfigService,
    userId,
  );

  if (!summary.canCompleteBalance || summary.remainingBalance <= 0) {
    throw new BadRequestException(
      "No tienes saldo pendiente o tu plan no admite liquidación completa en este momento.",
    );
  }

  return {
    userId,
    seasonYear: summary.seasonYear,
    remainingInstallments: summary.remainingInstallments,
    remainingBalance: summary.remainingBalance,
    targetInstallments: summary.targetInstallments,
    installmentsPaid: summary.installmentsPaid,
    isRenewal: summary.isRenewal,
    isInGracePeriod: summary.isInGracePeriod,
    description: `BSKMT — Liquidación 100% Plan Ahorro (${summary.remainingInstallments} cuotas restantes)`,
  };
}
