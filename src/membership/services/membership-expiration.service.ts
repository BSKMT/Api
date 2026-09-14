import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { User, UserDocument, UserRole } from "../../users/schemas/user.schema";
import { NotificationsService } from "../../notifications/notifications.service";
import {
  NotificationType,
  NotificationPriority,
} from "../../notifications/schemas/notification.schema";
import {
  executeRevokeWithoutCredit,
  executeRevokeWithPartialCredit,
} from "./membership-expiration.helpers";

@Injectable()
export class MembershipExpirationService {
  private readonly logger = new Logger(MembershipExpirationService.name);

  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly notificationsService: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleMembershipExpiration() {
    this.logger.log("Running membership expiration check...");

    const now = new Date();
    await this.startGracePeriods(now);
    await this.revokeExpiredGracePeriodMembers(now);

    this.logger.log("Membership expiration check completed");
  }

  /**
   * Inicia el periodo de gracia para los miembros cuya membresia expiro y
   * aun no tienen periodo de gracia asignado.
   */
  private async startGracePeriods(now: Date): Promise<void> {
    const expiredMembers = await this.userModel.find({
      role: UserRole.MEMBER,
      membershipExpiryDate: { $lt: now },
      membershipGracePeriodEnd: null,
      membershipExpired: false,
    });
    if (expiredMembers.length === 0) return;

    this.logger.log(
      `Found ${expiredMembers.length} members with expired membership. Starting grace period...`,
    );

    const gracePeriodEnd = new Date(now);
    gracePeriodEnd.setMonth(gracePeriodEnd.getMonth() + 1);

    for (const member of expiredMembers) {
      await this.startGracePeriodFor(member, now, gracePeriodEnd);
    }
  }

  /** Inicia el periodo de gracia de un miembro concreto (con guarda atomica M-8). */
  private async startGracePeriodFor(
    member: UserDocument,
    now: Date,
    gracePeriodEnd: Date,
  ): Promise<void> {
    // M-8: Atomic precondition check — only start grace period if
    //       not renewed/refreshed between find() and updateOne()
    const updateResult = await this.userModel.findOneAndUpdate(
      {
        _id: member._id,
        membershipExpired: false,
        membershipGracePeriodEnd: null,
        membershipExpiryDate: { $lt: now },
      },
      { membershipGracePeriodEnd: gracePeriodEnd },
      { new: true },
    );
    if (!updateResult) {
      this.logger.log(
        `Skipping grace period for ${String(member._id)} — membership state changed between find and update.`,
      );
      return;
    }

    this.logger.log(
      `Grace period started for user ${String(member._id)}. Ends: ${gracePeriodEnd.toISOString()}`,
    );

    await this.notificationsService.create({
      userId: String(member._id),
      type: NotificationType.MEMBERSHIP_GRACE_PERIOD,
      title: "Membresía expirada — Periodo de gracia",
      message: `Tu membresía Legend expiró. Tienes hasta el ${gracePeriodEnd.toLocaleDateString("es-CO")} para renovar y mantener tus beneficios.`,
      priority: NotificationPriority.HIGH,
      metadata: {
        previousExpiry: member.membershipExpiryDate,
        gracePeriodEnd: gracePeriodEnd.toISOString(),
      },
      notifyCategory: "Membresia y pagos",
    });
  }

  /**
   * Revoca la membresia de los miembros cuyo periodo de gracia ya expiro,
   * convirtiendo cuotas parciales en credito cuando corresponda.
   */
  private async revokeExpiredGracePeriodMembers(now: Date): Promise<void> {
    const gracePeriodExpired = await this.userModel.find({
      role: UserRole.MEMBER,
      membershipGracePeriodEnd: { $lt: now },
      membershipExpired: false,
    });
    if (gracePeriodExpired.length === 0) return;

    this.logger.log(
      `Found ${gracePeriodExpired.length} members with expired grace period. Reverting to user role...`,
    );

    for (const member of gracePeriodExpired) {
      await this.revokeExpiredMember(member, now);
    }
  }

  /** Revoca un miembro con periodo de gracia expirado, con o sin cuotas parciales. */
  private async revokeExpiredMember(
    member: UserDocument,
    now: Date,
  ): Promise<void> {
    const partialRenewalCount = member.renewalInstallmentsPaid ?? 0;
    if (partialRenewalCount > 0) {
      await this.revokeWithPartialCredit(member, now, partialRenewalCount);
    } else {
      await this.revokeWithoutCredit(member, now);
    }
  }

  private async revokeWithPartialCredit(
    member: UserDocument,
    now: Date,
    partialRenewalCount: number,
  ): Promise<void> {
    return executeRevokeWithPartialCredit(
      this.userModel,
      this.notificationsService,
      member,
      now,
      partialRenewalCount,
      this.logger,
    );
  }

  private async revokeWithoutCredit(
    member: UserDocument,
    now: Date,
  ): Promise<void> {
    return executeRevokeWithoutCredit(
      this.userModel,
      this.notificationsService,
      member,
      now,
      this.logger,
    );
  }
}
