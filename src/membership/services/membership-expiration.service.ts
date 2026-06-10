import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { User, UserDocument, UserRole } from "../../users/schemas/user.schema";

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
        await this.userModel.updateOne(
          { _id: member._id },
          {
            role: UserRole.USER,
            membershipLevel: null,
            membershipStartDate: null,
            membershipExpiryDate: null,
            membershipPaymentPlan: null,
            installmentsPaid: 0,
            renewalInstallmentsPaid: 0,
            membershipGracePeriodEnd: null,
            membershipExpired: true,
          },
        );

        this.logger.log(
          `User ${String(member._id)} reverted to user role after grace period expiration`,
        );
      }
    }

    this.logger.log("Membership expiration check completed");
  }
}
