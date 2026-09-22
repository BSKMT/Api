import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import {
  User,
  UserDocument,
  UserSubrole,
  CreditType,
  PartialPaymentCredit,
  FriendRequest,
} from "./schemas/user.schema";
import { executeCreateUser } from "./users-create.helper";
import {
  executeActivateMembership,
  executeUpdatePartialPaymentCredit,
  executeUpdatePartialPaymentCreditIfType,
  executeIncrementPartialPaymentCreditUsedAmount,
  executeCreatePartialPaymentCredit,
  executeClearPartialPaymentCredit,
  executeRevertPartialPaymentCredit,
  executeUpdateInstallmentsPaid,
  executeIncrementInstallmentsPaid,
  executeUpdateMembershipRenewal,
  executeIncrementRenewalInstallmentsPaid,
} from "./users-credit.helper";
import {
  executeEnsureOfficialNumber,
  executeUpdateProfileSection,
  executeDeleteProfileSection,
} from "./users-profile.helper";
import {
  executeListUsers,
  executeFindStaffBySubroles,
} from "./users-query.helper";

import { KvCacheService } from "../kv/kv-cache.service";

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly kvCache: KvCacheService,
  ) {}

  async invalidateUserCache(betterAuthId?: string | null): Promise<void> {
    if (!betterAuthId) return;
    await this.kvCache.delete(`user:ba:${betterAuthId}`, true).catch(() => {});
  }

  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email: email.toLowerCase() }).lean();
  }

  async findById(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).lean();
  }

  async findByBetterAuthId(betterAuthId: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ betterAuthId }).lean();
  }

  async findByMemberNumber(
    numeroMiembro: string,
  ): Promise<UserDocument | null> {
    return this.userModel
      .findOne({ "profile.membresia-ecosistema.numeroMiembro": numeroMiembro })
      .lean();
  }

  async ensureOfficialNumber(
    user: UserDocument | Record<string, unknown>,
  ): Promise<string> {
    return executeEnsureOfficialNumber(this.userModel, user);
  }

  async addFriendRequest(
    targetUserId: string,
    request: FriendRequest,
  ): Promise<void> {
    await this.userModel.updateOne(
      { _id: targetUserId },
      { $push: { friendRequests: request } },
    );
  }

  async respondToFriendRequest(
    userId: string,
    requestId: string,
    status: "accepted" | "declined",
  ): Promise<void> {
    await this.userModel.updateOne(
      { _id: userId, "friendRequests._id": requestId },
      { $set: { "friendRequests.$.status": status } },
    );
  }

  async create(betterAuthId: string, email: string): Promise<UserDocument> {
    return executeCreateUser(this.userModel, betterAuthId, email);
  }

  async updateProfileSection(
    userId: string,
    sectionId: string,
    sectionData: Record<string, unknown>,
  ): Promise<UserDocument> {
    return executeUpdateProfileSection(
      this.userModel,
      userId,
      sectionId,
      sectionData,
    );
  }

  async acceptLegalConsent(userId: string): Promise<UserDocument> {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException("Usuario no encontrado");
    }
    user.legalConsentAccepted = true;
    return user.save();
  }

  async deleteProfileSection(
    userId: string,
    sectionId: string,
  ): Promise<UserDocument> {
    return executeDeleteProfileSection(this.userModel, userId, sectionId);
  }

  async activateMembership(
    userId: string,
    startDate: Date,
    expiryDate: Date,
    paymentPlan: string,
  ): Promise<UserDocument> {
    return executeActivateMembership(
      this.userModel,
      userId,
      startDate,
      expiryDate,
      paymentPlan,
    );
  }

  async updateInstallmentsPaid(userId: string, count: number): Promise<void> {
    return executeUpdateInstallmentsPaid(this.userModel, userId, count);
  }

  async incrementInstallmentsPaid(userId: string): Promise<number> {
    return executeIncrementInstallmentsPaid(this.userModel, userId);
  }

  async updateMembershipRenewal(
    userId: string,
    renewalCount: number,
  ): Promise<void> {
    return executeUpdateMembershipRenewal(this.userModel, userId, renewalCount);
  }

  async incrementRenewalInstallmentsPaid(userId: string): Promise<number> {
    return executeIncrementRenewalInstallmentsPaid(this.userModel, userId);
  }

  async updatePartialPaymentCredit(
    userId: string,
    credit: PartialPaymentCredit,
  ): Promise<void> {
    return executeUpdatePartialPaymentCredit(this.userModel, userId, credit);
  }

  async updatePartialPaymentCreditIfType(
    userId: string,
    expectedType: CreditType,
    newCredit: PartialPaymentCredit,
  ): Promise<boolean> {
    return executeUpdatePartialPaymentCreditIfType(
      this.userModel,
      userId,
      expectedType,
      newCredit,
    );
  }

  async incrementPartialPaymentCreditUsedAmount(
    userId: string,
    increment: number,
    expectedUsedAmount: number,
  ): Promise<UserDocument | null> {
    return executeIncrementPartialPaymentCreditUsedAmount(
      this.userModel,
      userId,
      increment,
      expectedUsedAmount,
    );
  }

  async createPartialPaymentCredit(
    userId: string,
    amount: number,
    installmentsPaid: number,
  ): Promise<void> {
    return executeCreatePartialPaymentCredit(
      this.userModel,
      userId,
      amount,
      installmentsPaid,
    );
  }

  async clearPartialPaymentCredit(userId: string): Promise<void> {
    return executeClearPartialPaymentCredit(this.userModel, userId);
  }

  async revertPartialPaymentCredit(
    userId: string,
    amount: number,
  ): Promise<boolean> {
    return executeRevertPartialPaymentCredit(this.userModel, userId, amount);
  }

  async updateSubrol(
    userId: string,
    subrol: UserSubrole | string | null,
  ): Promise<UserDocument> {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException("Usuario no encontrado");
    }
    user.subrol = subrol ?? null;
    const saved = await user.save();
    await this.invalidateUserCache(user.betterAuthId);
    return saved;
  }

  async listUsers(filters: {
    search?: string;
    role?: string;
    subrol?: string;
    limit?: number;
    page?: number;
  }) {
    return executeListUsers(this.userModel, filters);
  }

  async findStaffBySubroles(subroles: string[]) {
    return executeFindStaffBySubroles(this.userModel, subroles);
  }
}
