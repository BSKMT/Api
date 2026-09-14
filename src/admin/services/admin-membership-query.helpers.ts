import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Model } from "mongoose";
import { MembershipTransactionDocument } from "../../membership/schemas/membership-transaction.schema";
import {
  ServiceCreditTransactionDocument,
  CreditTransactionType,
} from "../../membership/schemas/service-credit-transaction.schema";
import {
  UserDocument,
  UserRole,
  CreditType,
} from "../../users/schemas/user.schema";
import { ensureString } from "../../common/utils/sanitize-query.util";

export async function queryTransactions(
  transactionModel: Model<MembershipTransactionDocument>,
  filters: {
    status?: string;
    userId?: string;
    isRenewal?: boolean;
    limit?: number;
    page?: number;
  },
) {
  const filter: Record<string, unknown> = {};
  const status = ensureString(filters.status);
  const userId = ensureString(filters.userId);
  if (status) filter.status = status;
  if (userId) {
    if (!/^[a-fA-F0-9]{24}$/.test(userId)) {
      throw new BadRequestException("userId inválido");
    }
    filter.userId = userId;
  }
  if (filters.isRenewal !== undefined) filter.isRenewal = filters.isRenewal;

  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 100);
  const page = Math.max(filters.page ?? 1, 1);
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    transactionModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select("-webhookEvents")
      .lean(),
    transactionModel.countDocuments(filter),
  ]);

  return {
    items,
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

export async function queryMembers(
  userModel: Model<UserDocument>,
  filters: {
    status?: "active" | "expired" | "user";
    limit?: number;
    page?: number;
  },
) {
  const filter: Record<string, unknown> = {};
  if (filters.status === "active") filter.role = UserRole.MEMBER;
  if (filters.status === "user") filter.role = UserRole.USER;
  if (filters.status === "expired") {
    filter.membershipExpired = true;
  }

  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 100);
  const page = filters.page ?? 1;
  const skip = (page - 1) * limit;

  const SENSITIVE_PROFILE_EXCLUSIONS =
    "-profile.salud-seguridad -profile.documentacion-legal";

  const [items, total] = await Promise.all([
    userModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select("-betterAuthId " + SENSITIVE_PROFILE_EXCLUSIONS)
      .lean(),
    userModel.countDocuments(filter),
  ]);

  return {
    items,
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

export async function queryMemberDetails(
  userModel: Model<UserDocument>,
  transactionModel: Model<MembershipTransactionDocument>,
  userId: string,
) {
  const user = await userModel
    .findById(userId)
    .select(
      "-password -refreshTokenHash -profile.salud-seguridad -profile.documentacion-legal",
    )
    .lean();
  if (!user) {
    throw new NotFoundException("Usuario no encontrado");
  }

  const transactions = await transactionModel
    .find({ userId })
    .sort({ createdAt: -1 })
    .select("-webhookEvents -payerEmail -paymentMethod")
    .lean();

  return { user, transactions };
}

export async function queryPendingRefunds(
  userModel: Model<UserDocument>,
  creditTransactionModel: Model<ServiceCreditTransactionDocument>,
) {
  const usersWithRequestedRefund = await userModel
    .find({
      "partialPaymentCredit.type": CreditType.REFUND_REQUESTED,
    })
    .select("-password -refreshTokenHash")
    .lean();

  const userIds = usersWithRequestedRefund.map((u) => String(u._id));
  const transactions = userIds.length
    ? await creditTransactionModel
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
