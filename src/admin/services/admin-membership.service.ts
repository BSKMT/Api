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
  CreditTransactionType,
  CreditSource,
} from "../../membership/schemas/service-credit-transaction.schema";
import {
  User,
  UserDocument,
  UserRole,
  CreditType,
} from "../../users/schemas/user.schema";
import { NotificationsService } from "../../notifications/notifications.service";
import {
  NotificationType,
  NotificationPriority,
} from "../../notifications/schemas/notification.schema";
import { MEMBERSHIP_DURATION_MS } from "../../membership/membership.constants";

@Injectable()
export class AdminMembershipService {
  private readonly logger = new Logger(AdminMembershipService.name);

  constructor(
    @InjectModel(MembershipTransaction.name)
    private transactionModel: Model<MembershipTransactionDocument>,
    @InjectModel(ServiceCreditTransaction.name)
    private creditTransactionModel: Model<ServiceCreditTransactionDocument>,
    @InjectModel(User.name)
    private userModel: Model<UserDocument>,
    private readonly notificationsService: NotificationsService,
  ) {}

  async listTransactions(filters: {
    status?: string;
    userId?: string;
    isRenewal?: boolean;
    limit?: number;
    page?: number;
  }) {
    const filter: Record<string, unknown> = {};
    if (filters.status) filter.status = filters.status;
    if (filters.userId) filter.userId = filters.userId;
    if (filters.isRenewal !== undefined) filter.isRenewal = filters.isRenewal;

    const limit = filters.limit ?? 50;
    const page = filters.page ?? 1;
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.transactionModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select("-webhookEvents")
        .lean(),
      this.transactionModel.countDocuments(filter),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async getTransaction(reference: string) {
    const tx = await this.transactionModel.findOne({ reference }).lean();
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
    const filter: Record<string, unknown> = {};
    if (filters.status === "active") filter.role = UserRole.MEMBER;
    if (filters.status === "user") filter.role = UserRole.USER;
    if (filters.status === "expired") {
      filter.membershipExpired = true;
    }

    const limit = filters.limit ?? 50;
    const page = filters.page ?? 1;
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.userModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select("-password -refreshTokenHash")
        .lean(),
      this.userModel.countDocuments(filter),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async getMember(userId: string) {
    const user = await this.userModel
      .findById(userId)
      .select("-password -refreshTokenHash")
      .lean();
    if (!user) {
      throw new NotFoundException("Usuario no encontrado");
    }

    const transactions = await this.transactionModel
      .find({ userId })
      .sort({ createdAt: -1 })
      .select("-webhookEvents")
      .lean();

    return { user, transactions };
  }

  async activateMembership(userId: string) {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException("Usuario no encontrado");
    }

    const now = new Date();
    const baseDate =
      user.membershipExpiryDate && new Date(user.membershipExpiryDate) > now
        ? new Date(user.membershipExpiryDate)
        : now;
    const expiry = new Date(baseDate.getTime() + MEMBERSHIP_DURATION_MS);

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
      metadata: {
        adminAction: true,
        newExpiry: expiry.toISOString(),
      },
    });

    this.logger.log(
      `Membership admin-activated: user=${userId} expiry=${expiry.toISOString()}`,
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
    unit: "days" | "months" | "years",
    amount: number = 1,
    baseDateStr?: string,
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

    const now = new Date();
    const baseDate =
      baseDateStr && user.membershipExpiryDate
        ? new Date(baseDateStr)
        : user.membershipExpiryDate
          ? new Date(user.membershipExpiryDate)
          : now;
    const start = baseDate > now ? baseDate : now;

    const expiry = new Date(start);
    const qty = Math.max(1, Math.floor(amount));
    switch (unit) {
      case "days":
        expiry.setDate(expiry.getDate() + qty);
        break;
      case "months":
        expiry.setMonth(expiry.getMonth() + qty);
        break;
      case "years":
        expiry.setFullYear(expiry.getFullYear() + qty);
        break;
    }

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
      metadata: {
        adminAction: true,
        unit,
        newExpiry: expiry.toISOString(),
      },
    });

    this.logger.log(
      `Membership admin-extended: user=${userId} unit=${unit} newExpiry=${expiry.toISOString()}`,
    );
    return {
      userId,
      membershipExpiryDate: user.membershipExpiryDate,
    };
  }

  async revokeMembership(userId: string) {
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

    this.logger.log(`Membership admin-revoked: user=${userId}`);
    return { userId, role: user.role };
  }

  async listPendingRefunds() {
    const usersWithRequestedRefund = await this.userModel
      .find({
        "partialPaymentCredit.type": CreditType.REFUND_REQUESTED,
      })
      .select("-password -refreshTokenHash")
      .lean();

    const userIds = usersWithRequestedRefund.map((u) => String(u._id));
    const transactions = userIds.length
      ? await this.creditTransactionModel
          .find({
            userId: { $in: userIds },
            transactionType: CreditTransactionType.CREDIT_REFUNDED,
          })
          .sort({ createdAt: -1 })
          .lean()
      : [];

    return {
      count: usersWithRequestedRefund.length,
      refunds: usersWithRequestedRefund.map((u) => {
        const credit = u.partialPaymentCredit;
        const tx = transactions.find((t) => String(t.userId) === String(u._id));
        return {
          userId: String(u._id),
          email: u.email,
          membershipLevel: u.membershipLevel,
          creditAmount: credit?.amount ?? 0,
          installmentsPaid: credit?.installmentsPaid ?? 0,
          refundReference: tx?.reference ?? null,
          refundRequestedAt: credit?.refundRequestedAt ?? null,
          notes: credit?.notes ?? null,
        };
      }),
    };
  }

  async approveRefund(userId: string) {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException("Usuario no encontrado");
    }
    const credit = user.partialPaymentCredit;
    if (!credit || credit.type !== CreditType.REFUND_REQUESTED) {
      throw new BadRequestException(
        "El usuario no tiene una solicitud de reembolso pendiente",
      );
    }

    const timestamp = Date.now();
    const shortUserId = userId.slice(-8);
    const reference = `REF-APR-${shortUserId}-${timestamp}`;

    await this.creditTransactionModel.create({
      userId,
      reference,
      transactionType: CreditTransactionType.CREDIT_REFUNDED,
      creditSource: CreditSource.MEMBERSHIP,
      amount: credit.amount,
      description: `Reembolso aprobado por administración (${credit.installmentsPaid} cuotas)`,
      metadata: {
        adminAction: true,
        installmentsPaid: credit.installmentsPaid,
        originalCreditAmount: credit.amount,
        status: "approved-by-admin",
      },
    });

    await this.userModel.updateOne(
      { _id: userId },
      {
        partialPaymentCredit: {
          ...credit,
          type: CreditType.REFUNDED,
          notes: `Reembolso aprobado por admin. Ref: ${reference}`,
        },
      },
    );

    await this.notificationsService.create({
      userId,
      type: NotificationType.MEMBERSHIP_PAYMENT_REJECTED,
      title: "Reembolso aprobado",
      message: `Tu solicitud de reembolso fue aprobada. Monto: ${credit.amount.toLocaleString("es-CO")} COP. Ref: ${reference}.`,
      priority: NotificationPriority.HIGH,
      metadata: {
        adminAction: true,
        reference,
        amount: credit.amount,
      },
    });

    this.logger.log(
      `Refund admin-approved: user=${userId} amount=${credit.amount} ref=${reference}`,
    );
    return {
      success: true,
      reference,
      amount: credit.amount,
      status: "approved",
    };
  }

  async rejectRefund(userId: string, reason?: string) {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException("Usuario no encontrado");
    }
    const credit = user.partialPaymentCredit;
    if (!credit || credit.type !== CreditType.REFUND_REQUESTED) {
      throw new BadRequestException(
        "El usuario no tiene una solicitud de reembolso pendiente",
      );
    }

    await this.userModel.updateOne(
      { _id: userId },
      {
        partialPaymentCredit: {
          ...credit,
          type: CreditType.MEMBERSHIP,
          refundRequestedAt: null,
          notes: `Reembolso rechazado por admin. Crédito convertido a membresía. Motivo: ${reason ?? "sin motivo"}`,
        },
      },
    );

    const timestamp = Date.now();
    const shortUserId = userId.slice(-8);
    const reference = `REF-REJ-${shortUserId}-${timestamp}`;
    await this.creditTransactionModel.create({
      userId,
      reference,
      transactionType: CreditTransactionType.CREDIT_CONVERTED_TO_MEMBERSHIP,
      creditSource: CreditSource.MEMBERSHIP,
      amount: credit.amount,
      description: `Reembolso rechazado por admin — crédito revertido a membresía. Motivo: ${reason ?? "sin motivo"}`,
      metadata: {
        adminAction: true,
        installmentsPaid: credit.installmentsPaid,
        status: "rejected-by-admin",
        reason: reason ?? null,
      },
    });

    await this.notificationsService.create({
      userId,
      type: NotificationType.MEMBERSHIP_PAYMENT_REJECTED,
      title: "Solicitud de reembolso rechazada",
      message: `Tu solicitud de reembolso fue rechazada. Tu crédito se mantiene disponible para membresía/servicios. Motivo: ${reason ?? "sin motivo"}.`,
      priority: NotificationPriority.MEDIUM,
      metadata: {
        adminAction: true,
        reference,
      },
    });

    this.logger.log(
      `Refund admin-rejected: user=${userId} reason=${reason ?? ""}`,
    );
    return { success: true, reference, status: "rejected" };
  }
}
