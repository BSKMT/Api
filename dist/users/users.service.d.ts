import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentConfig } from '../config/config.interface';
import { UserDocument } from './schemas/user.schema';
import { RegisterDto } from '../auth/dto/register.dto';
export declare class UsersService {
    private userModel;
    private configService;
    constructor(userModel: Model<UserDocument>, configService: ConfigService<EnvironmentConfig>);
    findByEmail(email: string): Promise<UserDocument | null>;
    findById(id: string): Promise<UserDocument | null>;
    create(dto: RegisterDto): Promise<UserDocument>;
    updateRefreshTokenHash(userId: string, refreshTokenHash: string | null): Promise<void>;
    updateProfileSection(userId: string, sectionId: string, sectionData: Record<string, unknown>): Promise<UserDocument>;
    deleteProfileSection(userId: string, sectionId: string): Promise<UserDocument>;
}
