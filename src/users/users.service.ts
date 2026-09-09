import { randomInt } from "node:crypto";
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

/**
 * Generates a 10-digit official identification number according to the BSK specification:
 * - First 3 digits: always "901"
 * - Middle 3 digits: "411" for regular users (usuarios) or "412" for active members (miembros)
 * - Last 4 digits: random 4-digit unique number (0000-9999)
 * Format: 901411xxxx (user) / 901412xxxx (member)
 */
async function generateOfficialNumber(
  userModel: Model<UserDocument>,
  isMember: boolean,
  fixedSuffix?: string,
): Promise<string> {
  const prefix = isMember ? "901412" : "901411";

  if (fixedSuffix && /^\d{4}$/.test(fixedSuffix)) {
    const candidate = `${prefix}${fixedSuffix}`;
    const exists = await userModel
      .findOne({ "profile.membresia-ecosistema.numeroMiembro": candidate })
      .lean();
    if (!exists) return candidate;
  }

  for (let attempt = 0; attempt < 50; attempt++) {
    const randomSuffix = String(randomInt(0, 10000)).padStart(4, "0");
    const candidate = `${prefix}${randomSuffix}`;
    const exists = await userModel
      .findOne({ "profile.membresia-ecosistema.numeroMiembro": candidate })
      .lean();
    if (!exists) return candidate;
  }

  const fallbackSuffix = String(Date.now() % 10000).padStart(4, "0");
  return `${prefix}${fallbackSuffix}`;
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
   * (stored in profile["membresia-ecosistema"].numeroMiembro, e.g. "9014121234").
   * Used by the public profile endpoint.
   */
  async findByMemberNumber(
    numeroMiembro: string,
  ): Promise<UserDocument | null> {
    return this.userModel
      .findOne({ "profile.membresia-ecosistema.numeroMiembro": numeroMiembro })
      .lean();
  }

  /**
   * Guarantees that a user has a valid 10-digit official number matching their
   * current status: 901411xxxx (usuario) or 901412xxxx (miembro).
   * Migrates legacy "BSK-0001" or missing numbers automatically.
   */
  async ensureOfficialNumber(
    user: UserDocument | Record<string, unknown>,
  ): Promise<string> {
    const profile =
      (user as { profile?: Record<string, Record<string, unknown>> }).profile ??
      {};
    const memSection = profile["membresia-ecosistema"] ?? {};
    const currentNum =
      typeof memSection.numeroMiembro === "string"
        ? memSection.numeroMiembro
        : "";
    const isMember =
      (user as { membershipLevel?: string }).membershipLevel === "Legend";
    const expectedPrefix = isMember ? "901412" : "901411";

    if (new RegExp(String.raw`^${expectedPrefix}\d{4}$`).test(currentNum)) {
      return currentNum;
    }

    let suffix: string | undefined;
    const match10 = /^90141[12](\d{4})$/.exec(currentNum);
    if (match10) {
      suffix = match10[1];
    }

    const newNumber = await generateOfficialNumber(
      this.userModel,
      isMember,
      suffix,
    );

    const userId = (user as { _id?: string })._id;
    if (userId) {
      memSection.numeroMiembro = newNumber;
      if (!memSection.fechaIngreso) {
        memSection.fechaIngreso = getColombiaDate();
      }
      profile["membresia-ecosistema"] = memSection;
      await this.userModel.updateOne(
        { _id: userId },
        { $set: { "profile.membresia-ecosistema": memSection } },
      );
    }

    return newNumber;
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
   * Automatically provisions a 10-digit official user number (901411xxxx).
   */
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

    /**
     * A-KYC: if the user changes their identity document after being
     * verified, the verification no longer applies to the declared
     * identity — reset it so they must re-verify (OWASP A01). This
     * prevents verify-then-swap attacks where someone verifies with
     * their own document and later impersonates another document.
     */
    if (sectionId === "datos-personales" && user.identityVerified) {
      this.resetIdentityIfDocumentChanged(user, sanitizedData);
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
      const numMiembro =
        typeof memSection.numeroMiembro === "string"
          ? memSection.numeroMiembro
          : "";
      if (!numMiembro || !/^90141[12]\d{4}$/.test(numMiembro)) {
        const isMember = user.membershipLevel === "Legend";
        memSection.numeroMiembro = await generateOfficialNumber(
          this.userModel,
          isMember,
        );
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

  /**
   * A-KYC: invalida la verificacion de identidad cuando el tipo o el
   * numero de documento declarado cambia despues de una verificacion
   * exitosa. El registro verificado queda obsoleto y se limpia junto
   * con la bandera `identityVerified`.
   */
  private resetIdentityIfDocumentChanged(
    user: UserDocument,
    sanitizedData: Record<string, unknown>,
  ): void {
    const personal = user.profile?.["datos-personales"] ?? {};
    const oldType =
      typeof personal.tipoDocumento === "string" ? personal.tipoDocumento : "";
    const oldNumber =
      typeof personal.numeroDocumento === "string"
        ? personal.numeroDocumento
        : "";
    const newType =
      typeof sanitizedData.tipoDocumento === "string"
        ? sanitizedData.tipoDocumento
        : "";
    const newNumber =
      typeof sanitizedData.numeroDocumento === "string"
        ? sanitizedData.numeroDocumento
        : "";

    const normalizeNumber = (n: string): string => n.replace(/\D/g, "");
    const changed =
      (newType && newType !== oldType) ||
      (newNumber && normalizeNumber(newNumber) !== normalizeNumber(oldNumber));

    if (changed) {
      user.identityVerified = false;
      user.identityVerifiedAt = null;
      user.identityVerification = null;
    }
  }
}
