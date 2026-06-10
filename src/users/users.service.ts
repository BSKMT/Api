import {
  Injectable,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import * as bcrypt from "bcrypt";
import { ConfigService } from "@nestjs/config";
import type { EnvironmentConfig } from "../config/config.interface";
import {
  User,
  UserDocument,
  UserRole,
  CreditType,
  PartialPaymentCredit,
  REQUIRED_PROFILE_SECTIONS,
} from "./schemas/user.schema";
import { RegisterDto } from "../auth/dto/register.dto";

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
    private readonly configService: ConfigService<EnvironmentConfig>,
  ) {}

  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email: email.toLowerCase() }).lean();
  }

  async findById(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).lean();
  }

  async create(dto: RegisterDto): Promise<UserDocument> {
    const existing = await this.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException("El correo electronico ya esta registrado");
    }

    const saltRounds =
      this.configService.get<number>("BCRYPT_SALT_ROUNDS", 12) ?? 12;
    const passwordHash = await bcrypt.hash(dto.password, Number(saltRounds));

    const created = new this.userModel({
      email: dto.email.toLowerCase(),
      password: passwordHash,
      membershipLevel: null,
      role: "user",
      profileCompleted: false,
      completedSections: [],
      profile: {},
    });

    return created.save();
  }

  async updateRefreshTokenHash(
    userId: string,
    refreshTokenHash: string | null,
  ): Promise<void> {
    await this.userModel.updateOne({ _id: userId }, { refreshTokenHash });
  }

  async updateProfileSection(
    userId: string,
    sectionId: string,
    sectionData: Record<string, unknown>,
  ): Promise<UserDocument> {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException("Usuario no encontrado");
    }

    const profile = user.profile ?? {};
    profile[sectionId] = sectionData;

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

  async updateMembershipRenewal(
    userId: string,
    renewalCount: number,
  ): Promise<void> {
    await this.userModel.updateOne(
      { _id: userId },
      { renewalInstallmentsPaid: renewalCount },
    );
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
}
