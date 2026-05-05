import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentConfig } from '../config/config.interface';
import {
  User,
  UserDocument,
  REQUIRED_PROFILE_SECTIONS,
} from './schemas/user.schema';
import { RegisterDto } from '../auth/dto/register.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private configService: ConfigService<EnvironmentConfig>,
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
      throw new ConflictException('El correo electronico ya esta registrado');
    }

    const saltRounds = this.configService.get('bcryptSaltRounds', {
      infer: true,
    })!;
    const passwordHash = await bcrypt.hash(dto.password, saltRounds);

    const created = new this.userModel({
      email: dto.email.toLowerCase(),
      password: passwordHash,
      membershipLevel: 'Friend',
      role: 'user',
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
      throw new NotFoundException('Usuario no encontrado');
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

    user.profile = profile;
    user.completedSections = completedSections;
    user.profileCompleted = profileCompleted;

    return user.save();
  }

  async deleteProfileSection(
    userId: string,
    sectionId: string,
  ): Promise<UserDocument> {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
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

    return user.save();
  }
}
