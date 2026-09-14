import {
  Injectable,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
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
import {
  getColombiaDate,
  generateOfficialNumber,
} from "./users-official-number.helper";
import {
  executeActivateMembership,
  executeUpdatePartialPaymentCredit,
  executeUpdatePartialPaymentCreditIfType,
  executeIncrementPartialPaymentCreditUsedAmount,
  executeCreatePartialPaymentCredit,
  executeClearPartialPaymentCredit,
  executeRevertPartialPaymentCredit,
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

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

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
    const existing = await this.findByBetterAuthId(betterAuthId);
    if (existing) {
      throw new ConflictException("El usuario ya existe en la base de datos");
    }

    const officialNumber = await generateOfficialNumber(this.userModel, false);

    const created = new this.userModel({
      email: email.toLowerCase(),
      betterAuthId,
      role: "user",
      profileCompleted: false,
      completedSections: [],
      profile: {
        "membresia-ecosistema": {
          numeroMiembro: officialNumber,
          fechaIngreso: getColombiaDate(),
        },
      },
    });

    return created.save();
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
    await this.userModel.updateOne(
      { _id: userId },
      { installmentsPaid: count },
    );
  }

  async incrementInstallmentsPaid(userId: string): Promise<number> {
    const updated = await this.userModel.findOneAndUpdate(
      { _id: userId },
      { $inc: { installmentsPaid: 1 } },
      { new: true },
    );
    return updated?.installmentsPaid ?? 0;
  }

  async updateMembershipRenewal(
    userId: string,
    renewalCount: number,
  ): Promise<void> {
    await this.userModel.updateOne(
      { _id: userId },
      { renewalInstallmentsPaid: renewalCount },
    );
  }

  async incrementRenewalInstallmentsPaid(userId: string): Promise<number> {
    const updated = await this.userModel.findOneAndUpdate(
      { _id: userId },
      { $inc: { renewalInstallmentsPaid: 1 } },
      { new: true },
    );
    return updated?.renewalInstallmentsPaid ?? 0;
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
    return user.save();
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
