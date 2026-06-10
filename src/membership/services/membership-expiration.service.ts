import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { User, UserDocument, UserRole } from "../../users/schemas/user.schema";
import { INSTALLMENT_AMOUNT } from "../membership.constants";

@Injectable()
export class MembershipExpirationService {
  private readonly logger = new Logger(MembershipExpirationService.name);

  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleMembershipExpiration() {
    this.logger.log("Running membership expiration check...");

    const now = new Date();

    const expiredMembers = await this.userModel.find({
      role: UserRole.MEMBER,
      membershipExpiryDate: { $lt: now },
      membershipGracePeriodEnd: null,
      membershipExpired: false,
    });

    if (expiredMembers.length > 0) {
      this.logger.log(
        `Found ${expiredMembers.length} members with expired membership. Starting grace period...`,
      );

      const gracePeriodEnd = new Date(now);
      gracePeriodEnd.setMonth(gracePeriodEnd.getMonth() + 1);

      for (const member of expiredMembers) {
        await this.userModel.updateOne(
          { _id: member._id },
          { membershipGracePeriodEnd: gracePeriodEnd },
        );

        this.logger.log(
          `Grace period started for user ${String(member._id)}. Ends: ${gracePeriodEnd.toISOString()}`,
        );
      }
    }

    const gracePeriodExpired = await this.userModel.find({
      role: UserRole.MEMBER,
      membershipGracePeriodEnd: { $lt: now },
      membershipExpired: false,
    });

    if (gracePeriodExpired.length > 0) {
      this.logger.log(
        `Found ${gracePeriodExpired.length} members with expired grace period. Reverting to user role...`,
      );

      for (const member of gracePeriodExpired) {
        const hasPartialRenewal = (member.renewalInstallmentsPaid ?? 0) > 0;
        const partialRenewalCount = member.renewalInstallmentsPaid ?? 0;

        if (hasPartialRenewal) {
          const creditAmount = partialRenewalCount * INSTALLMENT_AMOUNT;

          await this.userModel.updateOne(
            { _id: member._id },
            {
              role: UserRole.USER,
              membershipLevel: null,
              membershipStartDate: null,
              membershipExpiryDate: null,
              membershipPaymentPlan: null,
              installmentsPaid: 0,
              membershipGracePeriodEnd: null,
              membershipExpired: true,
              renewalInstallmentsPaid: 0,
              partialPaymentCredit: {
                amount: creditAmount,
                installmentsPaid: partialRenewalCount,
                originalCurrency: "COP",
                createdAt: now,
                type: "pending",
                usedAmount: 0,
                expiresAt: null,
                refundRequestedAt: null,
                convertedAt: null,
                notes: `Crédito generado por ${partialRenewalCount} cuotas de renovación no completadas. El usuario debe elegir: crédito para membresía, crédito para servicios, o reembolso.`,
              },
            },
          );

          this.logger.log(
            `User ${String(member._id)} reverted to user role. ${partialRenewalCount} renewal installments converted to pending credit (${creditAmount} COP). User must choose: membership credit, service credit, or refund.`,
          );
        } else {
          await this.userModel.updateOne(
            { _id: member._id },
            {
              role: UserRole.USER,
              membershipLevel: null,
              membershipStartDate: null,
              membershipExpiryDate: null,
              membershipPaymentPlan: null,
              installmentsPaid: 0,
              membershipGracePeriodEnd: null,
              membershipExpired: true,
              renewalInstallmentsPaid: 0,
            },
          );

          this.logger.log(
            `User ${String(member._id)} reverted to user role after grace period expiration`,
          );
        }
      }
    }

    this.logger.log("Membership expiration check completed");
  }
}
