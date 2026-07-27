import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { User, UserDocument, UserRole } from "../../users/schemas/user.schema";
import { INSTALLMENT_AMOUNT } from "../membership.constants";
import { NotificationsService } from "../../notifications/notifications.service";
import {
  NotificationType,
  NotificationPriority,
} from "../../notifications/schemas/notification.schema";

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
      emailTo: member.email,
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

  /** Revoca un miembro que tenia cuotas de renovacion parciales, generando credito. */
  private async revokeWithPartialCredit(
    member: UserDocument,
    now: Date,
    partialRenewalCount: number,
  ): Promise<void> {
    const creditAmount = partialRenewalCount * INSTALLMENT_AMOUNT;

    // A-8: Precondition — refuse to overwrite any pre-existing credit on
    // the user document. Previously the cron unconditionally wrote
    // `partialPaymentCredit`, silently destroying credit that the user
    // already held from an earlier flow. Skip with a warn so an
    // administrator can manually reconcile the two balances.
    if (member.partialPaymentCredit) {
      this.logger.warn(
        `Skipping credit grant for ${String(member._id)}: a credit already exists (${(member.partialPaymentCredit as { amount: number }).amount} COP, type ${(member.partialPaymentCredit as { type?: string }).type}). Manual reconciliation required.`,
      );
      // Fall back to the no-credit revoke path so the role & dates are
      // still updated, but the existing credit is preserved.
      await this.revokeWithoutCredit(member, now);
      return;
    }

    // M-8: Atomic precondition check — only revoke if not refreshed between
    //       find() and updateOne (prevents cron from destroying active renewal)
    const updateResult = await this.userModel.findOneAndUpdate(
      {
        _id: member._id,
        membershipExpired: false,
        membershipGracePeriodEnd: { $lt: now },
        partialPaymentCredit: null,
      },
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
      { new: true },
    );
    if (!updateResult) {
      this.logger.log(
        `Skipping expiration for ${String(member._id)} — membership was renewed between find and update, or a credit was set concurrently.`,
      );
      return;
    }

    this.logger.log(
      `User ${String(member._id)} reverted to user role. ${partialRenewalCount} renewal installments converted to pending credit (${creditAmount} COP). User must choose: membership credit, service credit, or refund.`,
    );

    await this.notificationsService.create({
      userId: String(member._id),
      type: NotificationType.MEMBERSHIP_REVOKED,
      title: "Membresía revocada",
      message: `Tu membresía Legend fue revocada. Convertimos tus ${partialRenewalCount} cuotas de renovación en un crédito de ${creditAmount.toLocaleString("es-CO")} COP. Elige qué hacer con él desde tu panel de membresía.`,
      priority: NotificationPriority.HIGH,
      metadata: {
        creditAmount,
        partialRenewalCount,
      },
      emailTo: member.email,
    });
  }

  /** Revoca un miembro sin cuotas de renovacion parciales (sin credito). */
  private async revokeWithoutCredit(
    member: UserDocument,
    now: Date,
  ): Promise<void> {
    // M-8: Same atomic precondition guard
    const updateResult = await this.userModel.findOneAndUpdate(
      {
        _id: member._id,
        membershipExpired: false,
        membershipGracePeriodEnd: { $lt: now },
      },
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
      { new: true },
    );
    if (!updateResult) {
      this.logger.log(
        `Skipping expiration for ${String(member._id)} — membership was renewed between find and update.`,
      );
      return;
    }

    this.logger.log(
      `User ${String(member._id)} reverted to user role after grace period expiration`,
    );

    await this.notificationsService.create({
      userId: String(member._id),
      type: NotificationType.MEMBERSHIP_REVOKED,
      title: "Membresía revocada",
      message:
        "Tu periodo de gracia finalizó y tu membresía Legend fue revocada. Puedes adquirir una nueva membresía cuando lo desees.",
      priority: NotificationPriority.HIGH,
      emailTo: member.email,
    });
  }
}
