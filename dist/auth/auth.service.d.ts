import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import type { EnvironmentConfig } from '../config/config.interface';
export declare class AuthService {
    private usersService;
    private jwtService;
    private configService;
    constructor(usersService: UsersService, jwtService: JwtService, configService: ConfigService<EnvironmentConfig>);
    validateUser(email: string, password: string): Promise<{
        userId: string;
        email: string;
    } | null>;
    login(dto: LoginDto): Promise<{
        accessToken: string;
        refreshToken: string;
        user: {
            email: string;
            userId: string;
            profileCompleted: boolean;
            membershipLevel: string;
            role: string;
        };
    }>;
    register(dto: RegisterDto): Promise<{
        accessToken: string;
        refreshToken: string;
        user: {
            email: string;
            userId: string;
            profileCompleted: boolean;
            membershipLevel: string;
            role: string;
        };
    }>;
    refreshTokens(userId: string, incomingRefreshToken: string): Promise<{
        accessToken: string;
        refreshToken: string;
        user: {
            email: string;
            userId: string;
            profileCompleted: boolean;
            membershipLevel: string;
            role: string;
        };
    }>;
    logout(userId: string): Promise<void>;
    private generateTokens;
}
