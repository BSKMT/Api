import { NotFoundException, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Model } from "mongoose";
import { MembershipTransactionDocument } from "./schemas/membership-transaction.schema";
import { ServiceCreditTransactionDocument } from "./schemas/service-credit-transaction.schema";
import { CreateMembershipPaymentDto } from "./dto/create-membership-payment.dto";
import { UsersService } from "../users/users.service";
import { SystemPricingConfigService } from "../admin/services/system-pricing-config.service";
import {
  maskAmount,
  maskReference,
  maskUserId,
} from "../common/utils/log-redact.util";
import type { EnvironmentConfig } from "../config/config.interface";
import {
  INSTALLMENTS_TOTAL,
  MEMBERSHIP_NEW_MEMBER_AMOUNT,
  MEMBERSHIP_RENEWAL_AMOUNT,
  INSTALLMENT_AMOUNT,
} from "./membership.constants";
import {
  MembershipPaymentContext,
  applyCreditIfRequested,
} from "./membership-credit-apply.helpers";
import {
  formatMembershipDescription,
  buildMembershipReference,
  buildBoldConfig,
  validateRenewalEligibility,
  validateNewMembershipEligibility,
  computeNextInstallmentNumber,
  assertNoPendingMembershipTransaction,
} from "./membership-formatting.helpers";

export interface MembershipCreationDeps {
  transactionModel: Model<MembershipTransactionDocument>;
  creditTransactionModel: Model<ServiceCreditTransactionDocument>;
  usersService: UsersService;
  pricingConfigService: SystemPricingConfigService;
  configService: ConfigService<EnvironmentConfig>;
  logger: Logger;
  processApprovedPayment: (t: MembershipTransactionDocument) => Promise<void>;
}

export function buildPendingPaymentResponse(
  configService: ConfigService<EnvironmentConfig>,
  reference: string,
  totalAmount: number,
  remainingAmount: number,
  creditUsedAmount: number,
  ctx: MembershipPaymentContext,
  description: string,
) {
  const { installmentNumber, installmentTotal, isRenewal } = ctx;
  return {
    reference,
    amount: remainingAmount,
    totalAmount,
    creditUsed: creditUsedAmount,
    remainingAmount,
    status: "PENDING",
    installmentNumber,
    installmentTotal,
    isRenewal,
    paidWithCredit: creditUsedAmount > 0,
    description,
    boldConfig: buildBoldConfig(
      configService,
      reference,
      remainingAmount,
      description,
    ),
  };
}

export async function handleFullyPaidWithCreditHelper(
  deps: MembershipCreationDeps,
  userId: string,
  dto: CreateMembershipPaymentDto,
  totalAmount: number,
  ctx: MembershipPaymentContext,
  creditUsedAmount: number,
  now: Date,
) {
  const { installmentNumber, installmentTotal, isRenewal } = ctx;
  const reference = buildMembershipReference(
    dto.paymentPlan,
    isRenewal,
    installmentNumber,
    userId,
  );
  const transaction = new deps.transactionModel({
    userId,
    reference,
    paymentPlan: dto.paymentPlan,
    amount: totalAmount,
    installmentNumber,
    installmentTotal,
    status: "APPROVED",
    isRenewal,
    paidAt: now,
    paymentMethod: "credit",
  });
  await transaction.save();
  await deps.processApprovedPayment(transaction);
  deps.logger.log(
    `Membership fully paid with credit: user=${maskUserId(userId)} ref=${maskReference(reference)}`,
  );
  return {
    reference,
    amount: totalAmount,
    creditUsed: creditUsedAmount,
    remainingAmount: 0,
    status: "APPROVED",
    installmentNumber,
    installmentTotal,
    isRenewal,
    paidWithCredit: true,
    description: formatMembershipDescription(
      isRenewal,
      dto.paymentPlan,
      installmentNumber,
      installmentTotal,
      true,
    ),
  };
}

export async function createMembershipPaymentHelper(
  deps: MembershipCreationDeps,
  userId: string,
  dto: CreateMembershipPaymentDto,
) {
  const user = await deps.usersService.findById(userId);
  if (!user) throw new NotFoundException("Usuario no encontrado");

  const isRenewal = dto.isRenewal === true;
  const now = new Date();
  const membershipExpired =
    user.membershipExpiryDate != null &&
    new Date(user.membershipExpiryDate) < now;
  const isInGracePeriod =
    membershipExpired &&
    user.membershipGracePeriodEnd != null &&
    new Date(user.membershipGracePeriodEnd) > now;

  if (isRenewal) {
    validateRenewalEligibility(user.role, isInGracePeriod, membershipExpired);
  } else {
    validateNewMembershipEligibility(user.role, membershipExpired);
  }

  const pricingConfig = await deps.pricingConfigService.getConfig();
  const renewalAmt =
    pricingConfig.membership?.renewalAmount ?? MEMBERSHIP_RENEWAL_AMOUNT;
  const newMemberAmt =
    pricingConfig.membership?.newMemberAmount ?? MEMBERSHIP_NEW_MEMBER_AMOUNT;
  const singleAmount = isRenewal ? renewalAmt : newMemberAmt;

  const installmentAmt =
    pricingConfig.membership?.installmentAmount ?? INSTALLMENT_AMOUNT;
  const totalAmount =
    dto.paymentPlan === "single" ? singleAmount : installmentAmt;

  const installmentsTot =
    pricingConfig.membership?.installmentsTotal ?? INSTALLMENTS_TOTAL;
  const installmentTotal = dto.paymentPlan === "single" ? 1 : installmentsTot;
  const installmentNumber =
    dto.paymentPlan === "installment"
      ? await computeNextInstallmentNumber(
          deps.transactionModel,
          userId,
          isRenewal,
        )
      : 1;

  await assertNoPendingMembershipTransaction(
    deps.transactionModel,
    userId,
    dto.paymentPlan,
    isRenewal,
    installmentNumber,
  );

  const { creditUsedAmount, remainingAmount } = await applyCreditIfRequested(
    {
      usersService: deps.usersService,
      creditTransactionModel: deps.creditTransactionModel,
      logger: deps.logger,
    },
    userId,
    dto,
    user,
    totalAmount,
    { installmentNumber, installmentTotal, isRenewal },
    now,
  );

  if (remainingAmount === 0 && creditUsedAmount > 0) {
    return handleFullyPaidWithCreditHelper(
      deps,
      userId,
      dto,
      totalAmount,
      { installmentNumber, installmentTotal, isRenewal },
      creditUsedAmount,
      now,
    );
  }

  const reference = buildMembershipReference(
    dto.paymentPlan,
    isRenewal,
    installmentNumber,
    userId,
  );
  const transaction = new deps.transactionModel({
    userId,
    reference,
    paymentPlan: dto.paymentPlan,
    amount: remainingAmount,
    installmentNumber,
    installmentTotal,
    status: "PENDING",
    isRenewal,
    creditUsedAmount: creditUsedAmount,
  });
  await transaction.save();

  const description = formatMembershipDescription(
    isRenewal,
    dto.paymentPlan,
    installmentNumber,
    installmentTotal,
  );

  deps.logger.log(
    `Membership payment intent: ref=${maskReference(reference)} user=${maskUserId(userId)} amount=${maskAmount(remainingAmount)} (total=${maskAmount(totalAmount)}, credit=${maskAmount(creditUsedAmount)}) plan=${dto.paymentPlan} installment=${installmentNumber}/${installmentTotal} renewal=${isRenewal}`,
  );

  return buildPendingPaymentResponse(
    deps.configService,
    reference,
    totalAmount,
    remainingAmount,
    creditUsedAmount,
    { installmentNumber, installmentTotal, isRenewal },
    description,
  );
}
