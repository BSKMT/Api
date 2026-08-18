import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import {
  User,
  UserDocument,
  UserRole,
  CreditType,
  PartialPaymentCredit,
  FriendRequest,
  REQUIRED_PROFILE_SECTIONS,
} from "./schemas/user.schema";
import { UpdateProfileSectionDto } from "../profile/dto/update-profile-section.dto";
import { DeleteProfileSectionDto } from "../profile/dto/delete-profile-section.dto";

function getColombiaDate(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const colombiaMs = now.getTime() + (offset + 300) * 60000;
  return new Date(colombiaMs).toISOString().split("T")[0];
}

async function generateMemberNumber(
  userModel: Model<UserDocument>,
): Promise<string> {
  const lastUser = await userModel
    .find({ membershipLevel: { $ne: null } })
    .sort({ createdAt: -1 })
    .limit(1)
    .lean();

  let nextNum = 1;
  if (lastUser && lastUser.length > 0) {
    const lastProfile = lastUser[0].profile?.["membresia-ecosistema"];
    const lastNum = lastProfile?.numeroMiembro;
    if (typeof lastNum === "string") {
      const match = /BSK-(\d+)/.exec(lastNum);
      if (match) nextNum = Number.parseInt(match[1], 10) + 1;
    }
  }

  return `BSK-${String(nextNum).padStart(4, "0")}`;
}

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

  /**
   * Looks up a user by their auto-generated member number
   * (stored in profile["membresia-ecosistema"].numeroMiembro, e.g. "BSK-0001").
   * Used by the public profile endpoint.
   */
  async findByMemberNumber(numeroMiembro: string): Promise<UserDocument | null> {
    return this.userModel
      .findOne({ "profile.membresia-ecosistema.numeroMiembro": numeroMiembro })
      .lean();
  }

  /**
   * Appends a friend request to the target user's friendRequests array.
   * Called by PublicProfileController.sendFriendRequest.
   */
  async addFriendRequest(
    targetUserId: string,
    request: FriendRequest,
  ): Promise<void> {
    await this.userModel.updateOne(
      { _id: targetUserId },
      { $push: { friendRequests: request } },
    );
  }

  /**
   * Updates the status of a friend request (accept / decline).
   * Called by ProfileController.respondToFriendRequest.
   */
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

  /**
   * Creates a Mongoose business-data user linked to a Better Auth account.
   * Called from the Better Auth `databaseHooks.user.create.after` hook.
   */
  async create(betterAuthId: string, email: string): Promise<UserDocument> {
    const existing = await this.findByBetterAuthId(betterAuthId);
    if (existing) {
      throw new ConflictException("El usuario ya existe en la base de datos");
    }

    const created = new this.userModel({
      email: email.toLowerCase(),
      betterAuthId,
      role: "user",
      profileCompleted: false,
      completedSections: [],
      profile: {},
    });

    return created.save();
  }

  async updateProfileSection(
    userId: string,
    sectionId: string,
    sectionData: Record<string, unknown>,
  ): Promise<UserDocument> {
    if (!UpdateProfileSectionDto.isValidSectionId(sectionId)) {
      throw new BadRequestException(`Sección inválida: ${sectionId}`);
    }
    // A-12: pass sectionId to apply per-section forbidden keys (e.g., numeroMiembro)
    const sanitizedData = UpdateProfileSectionDto.sanitize(
      sectionData,
      sectionId,
    );
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException("Usuario no encontrado");
    }

    if (sectionId === "contacto") {
      this.syncPhoneIfChanged(user, sanitizedData);
    }

    const profile = user.profile ?? {};
    // A-12: For membresia-ecosistema, merge with existing data to preserve numeroMiembro
    if (sectionId === "membresia-ecosistema") {
      const existing =
        (profile[sectionId] as Record<string, unknown> | undefined) ?? {};
      profile[sectionId] = { ...existing, ...sanitizedData };
    } else {
      profile[sectionId] = sanitizedData;
    }

    const completedSections = [...(user.completedSections ?? [])];
    if (!completedSections.includes(sectionId)) {
      completedSections.push(sectionId);
    }

    const profileCompleted = REQUIRED_PROFILE_SECTIONS.every((s) =>
      completedSections.includes(s),
    );

    if (profileCompleted && !user.profileCompleted) {
      const memSection = profile["membresia-ecosistema"] ?? {};
      if (!memSection.fechaIngreso) {
        memSection.fechaIngreso = getColombiaDate();
      }
      if (!memSection.numeroMiembro) {
        memSection.numeroMiembro = await generateMemberNumber(this.userModel);
      }
      profile["membresia-ecosistema"] = memSection;
    }

    user.profile = profile;
    user.completedSections = completedSections;
    user.profileCompleted = profileCompleted;
    user.markModified("profile");

    return user.save();
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
    // ADM-12: Validate sectionId against whitelist
    if (!DeleteProfileSectionDto.isValidSectionId(sectionId)) {
      throw new BadRequestException(`Sección inválida: ${sectionId}`);
    }
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException("Usuario no encontrado");
    }

    const profile = user.profile ?? {};
    profile[sectionId] = {};

    const completedSections = (user.completedSections ?? []).filter(
      (s) => s !== sectionId,
    );

    const profileCompleted = REQUIRED_PROFILE_SECTIONS.every((s) =>
      completedSections.includes(s),
    );

    user.profile = profile;
    user.completedSections = completedSections;
    user.profileCompleted = profileCompleted;
    user.markModified("profile");

    return user.save();
  }

  async activateMembership(
    userId: string,
    startDate: Date,
    expiryDate: Date,
    paymentPlan: string,
  ): Promise<UserDocument> {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException("Usuario no encontrado");
    }

    user.role = UserRole.MEMBER;
    user.membershipLevel = "Legend";
    user.membershipStartDate = startDate;
    user.membershipExpiryDate = expiryDate;
    user.membershipPaymentPlan = paymentPlan;
    user.installmentsPaid =
      paymentPlan === "single" ? 12 : user.installmentsPaid;
    // C-4: Reset the renewal-installments counter upon successful
    // activation so the expired-membership cron does not re-grant
    // credit for an already-completed renewal cycle.
    user.renewalInstallmentsPaid = 0;
    user.membershipGracePeriodEnd = null;
    user.membershipExpired = false;

    return user.save();
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
    await this.userModel.updateOne(
      { _id: userId },
      { partialPaymentCredit: credit },
    );
  }

  /**
   * M-20: Atomic precondition update — only writes `partialPaymentCredit`
   * when its current `type` equals `expectedType`. Returns true when the
   * write applied; false when a concurrent caller beat us (race
   * protection for `chooseCreditOption` which previously did a
   * non-atomic read+update, allowing two simultaneous calls to convert
   * the same pending credit into two different target types and create
   * two ledger entries).
   */
  async updatePartialPaymentCreditIfType(
    userId: string,
    expectedType: CreditType,
    newCredit: PartialPaymentCredit,
  ): Promise<boolean> {
    const result = await this.userModel.updateOne(
      {
        _id: userId,
        "partialPaymentCredit.type": expectedType,
      },
      { $set: { partialPaymentCredit: newCredit } },
    );
    return result.modifiedCount > 0;
  }

  /**
   * Atomically increment partialPaymentCredit.usedAmount by `increment`,
   * only if the current usedAmount matches `expectedUsedAmount` (optimistic lock).
   * Returns the updated document or null if the precondition failed.
   */
  async incrementPartialPaymentCreditUsedAmount(
    userId: string,
    increment: number,
    expectedUsedAmount: number,
  ): Promise<UserDocument | null> {
    return this.userModel.findOneAndUpdate(
      {
        _id: userId,
        "partialPaymentCredit.usedAmount": expectedUsedAmount,
      },
      { $inc: { "partialPaymentCredit.usedAmount": increment } },
      { new: true },
    );
  }

  async createPartialPaymentCredit(
    userId: string,
    amount: number,
    installmentsPaid: number,
  ): Promise<void> {
    const credit: PartialPaymentCredit = {
      amount,
      installmentsPaid,
      originalCurrency: "COP",
      createdAt: new Date(),
      type: CreditType.PENDING,
      usedAmount: 0,
      expiresAt: null,
      refundRequestedAt: null,
      convertedAt: null,
      notes: `Crédito generado por ${installmentsPaid} cuotas de renovación no completadas`,
    };

    await this.userModel.updateOne(
      { _id: userId },
      { partialPaymentCredit: credit },
    );
  }

  async clearPartialPaymentCredit(userId: string): Promise<void> {
    await this.userModel.updateOne(
      { _id: userId },
      { partialPaymentCredit: null },
    );
  }

  // M9/C-3: Revert credit used amount when a membership payment fails/is
  // rejected, with an atomic precondition to prevent `usedAmount` from
  // going negative (which would inflate spendable credit). Returns true
  // when the revert actually applied; false when a concurrent caller
  // beat us or the available credit was already insufficient.
  async revertPartialPaymentCredit(
    userId: string,
    amount: number,
  ): Promise<boolean> {
    if (amount <= 0) return true;
    const result = await this.userModel.findOneAndUpdate(
      {
        _id: userId,
        "partialPaymentCredit.usedAmount": { $gte: amount },
      },
      { $inc: { "partialPaymentCredit.usedAmount": -amount } },
      { new: true },
    );
    if (result) return true;
    // Precondition failed — clamp any sub-zero usedAmount as a
    // defense-in-depth measure so credit can never be spent multiple
    // times via the negative-number trick.
    await this.userModel.updateOne(
      { _id: userId, "partialPaymentCredit.usedAmount": { $lt: 0 } },
      { $set: { "partialPaymentCredit.usedAmount": 0 } },
    );
    return false;
  }

  private extractPhoneFromContacto(
    contacto: Record<string, unknown> | undefined,
  ): string | null {
    if (!contacto) return null;
    const tel =
      contacto["telefono"] ??
      contacto["celular"] ??
      contacto["whatsapp"] ??
      contacto["phone"];
    if (typeof tel === "string" && tel.trim()) return tel.trim();
    return null;
  }

  /**
   * Sincroniza el campo top-level `user.phone` cuando se actualiza la
   * seccion "contacto".
   *
   * Si el telefono nuevo difiere del anterior, ademas resetea
   * `phoneVerified`/`phoneVerifiedAt`/`pendingPhone` para obligar al
   * usuario a re-verificarlo via el flujo de OTP antes de reanudar las
   * notificaciones por SMS.
   */
  private syncPhoneIfChanged(
    user: UserDocument,
    sanitizedData: Record<string, unknown>,
  ): void {
    const oldPhone = this.extractPhoneFromContacto(user.profile?.["contacto"]);
    const newPhone = this.extractPhoneFromContacto(sanitizedData);

    if (newPhone && newPhone !== oldPhone) {
      user.phone = newPhone;
      user.phoneVerified = false;
      user.phoneVerifiedAt = null;
      user.pendingPhone = null;
    } else if (newPhone && newPhone === oldPhone && user.phone !== newPhone) {
      user.phone = newPhone;
    }
  }
}
