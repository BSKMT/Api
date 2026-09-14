import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import {
  MembershipTransaction,
  MembershipTransactionDocument,
} from "../../membership/schemas/membership-transaction.schema";
import {
  ServiceCreditTransaction,
  ServiceCreditTransactionDocument,
} from "../../membership/schemas/service-credit-transaction.schema";
import { User, UserDocument, UserRole } from "../../users/schemas/user.schema";
import { NotificationsService } from "../../notifications/notifications.service";
import {
  NotificationType,
  NotificationPriority,
} from "../../notifications/schemas/notification.schema";
import {
  calculateActivationExpiry,
  calculateExtensionExpiry,
} from "./admin-membership.helpers";
import {
  executeApproveRefund,
  executeRejectRefund,
} from "./admin-membership-refund.helpers";
import {
  queryTransactions,
  queryMembers,
  queryMemberDetails,
  queryPendingRefunds,
} from "./admin-membership-query.helpers";

@Injectable()
export class AdminMembershipService {
  private readonly logger = new Logger(AdminMembershipService.name);

  constructor(
    @InjectModel(MembershipTransaction.name)
    private readonly transactionModel: Model<MembershipTransactionDocument>,
    @InjectModel(ServiceCreditTransaction.name)
    private readonly creditTransactionModel: Model<ServiceCreditTransactionDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly notificationsService: NotificationsService,
  ) {}

  async listTransactions(filters: {
    status?: string;
    userId?: string;
    isRenewal?: boolean;
    limit?: number;
    page?: number;
  }) {
    return queryTransactions(this.transactionModel, filters);
  }

  async getTransaction(reference: string) {
    const tx = await this.transactionModel
      .findOne({ reference })
      .select("-webhookEvents")
      .lean();
    if (!tx) {
      throw new NotFoundException("Transacción no encontrada");
    }
    return tx;
  }

  async listMembers(filters: {
    status?: "active" | "expired" | "user";
    limit?: number;
    page?: number;
  }) {
    return queryMembers(this.userModel, filters);
  }

  async getMember(userId: string) {
    return queryMemberDetails(this.userModel, this.transactionModel, userId);
  }

  async activateMembership(userId: string, actorId = "") {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException("Usuario no encontrado");
    }

    const { baseDate, expiry } = calculateActivationExpiry(
      user.membershipExpiryDate,
    );

    user.role = UserRole.MEMBER;
    user.membershipLevel = "Legend";
    user.membershipStartDate = user.membershipStartDate ?? baseDate;
    user.membershipPaymentPlan = user.membershipPaymentPlan ?? "single";
    user.installmentsPaid = user.installmentsPaid ?? 12;
    user.membershipExpiryDate = expiry;
    user.membershipGracePeriodEnd = null;
    user.membershipExpired = false;
    await user.save();

    await this.notificationsService.create({
      userId,
      type: NotificationType.MEMBERSHIP_ACTIVATED,
      title: "Membresía activada por administración",
      message: `Un administrador activó tu membresía Legend hasta el ${expiry.toLocaleDateString("es-CO")}.`,
      priority: NotificationPriority.HIGH,
      metadata: { adminAction: true, newExpiry: expiry.toISOString() },
    });

    this.logger.log(
      `Membership admin-activated: user=${userId} expiry=${expiry.toISOString()} actor=${actorId}`,
    );
    return {
      userId,
      role: user.role,
      membershipLevel: user.membershipLevel,
      membershipExpiryDate: user.membershipExpiryDate,
      membershipPaymentPlan: user.membershipPaymentPlan,
    };
  }

  async extendMembership(
    userId: string,
    unit: string,
    amount = 1,
    baseDateStr?: string,
    actorId = "",
  ) {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException("Usuario no encontrado");
    }
    if ((user.role as UserRole) !== UserRole.MEMBER) {
      throw new BadRequestException(
        "El usuario no tiene membresía activa para extender",
      );
    }

    const expiry = calculateExtensionExpiry(
      user.membershipExpiryDate,
      unit,
      amount,
      baseDateStr,
    );

    user.membershipExpiryDate = expiry;
    user.membershipGracePeriodEnd = null;
    user.membershipExpired = false;
    await user.save();

    await this.notificationsService.create({
      userId,
      type: NotificationType.MEMBERSHIP_ACTIVATED,
      title: "Membresía extendida por administración",
      message: `Un administrador extendió tu membresía Legend hasta el ${expiry.toLocaleDateString("es-CO")}.`,
      priority: NotificationPriority.MEDIUM,
      metadata: { adminAction: true, unit, newExpiry: expiry.toISOString() },
    });

    this.logger.log(
      `Membership admin-extended: user=${userId} unit=${unit} newExpiry=${expiry.toISOString()} actor=${actorId}`,
    );
    return { userId, membershipExpiryDate: user.membershipExpiryDate };
  }

  async revokeMembership(userId: string, actorId = "") {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException("Usuario no encontrado");
    }

    user.role = UserRole.USER;
    user.membershipLevel = null;
    user.membershipStartDate = null;
    user.membershipExpiryDate = null;
    user.membershipPaymentPlan = null;
    user.installmentsPaid = 0;
    user.membershipGracePeriodEnd = null;
    user.membershipExpired = true;
    user.renewalInstallmentsPaid = 0;
    await user.save();

    await this.notificationsService.create({
      userId,
      type: NotificationType.MEMBERSHIP_REVOKED,
      title: "Membresía revocada por administración",
      message:
        "Un administrador revocó tu membresía Legend. Si crees que es un error, contáctanos.",
      priority: NotificationPriority.HIGH,
      metadata: { adminAction: true },
    });

    this.logger.log(
      `Membership admin-revoked: user=${userId} actor=${actorId}`,
    );
    return { userId, role: user.role };
  }

  async listPendingRefunds() {
    return queryPendingRefunds(this.userModel, this.creditTransactionModel);
  }

  async approveRefund(userId: string, actorId = "") {
    return executeApproveRefund(
      this.userModel,
      this.creditTransactionModel,
      this.notificationsService,
      userId,
      actorId,
      this.logger,
    );
  }

  async rejectRefund(userId: string, reason?: string, actorId = "") {
    return executeRejectRefund(
      this.userModel,
      this.creditTransactionModel,
      this.notificationsService,
      userId,
      reason,
      actorId,
      this.logger,
    );
  }
}
