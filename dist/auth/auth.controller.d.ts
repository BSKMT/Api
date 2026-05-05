import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { UsersService } from '../users/users.service';
import type { EnvironmentConfig } from '../config/config.interface';
export declare class AuthController {
    private authService;
    private configService;
    private usersService;
    constructor(authService: AuthService, configService: ConfigService<EnvironmentConfig>, usersService: UsersService);
    login(req: Request, res: Response): Promise<{
        user: {
            email: string;
            userId: string;
            profileCompleted: boolean;
            membershipLevel: string;
            role: string;
        };
    }>;
    register(dto: RegisterDto, res: Response): Promise<{
        user: {
            email: string;
            userId: string;
            profileCompleted: boolean;
            membershipLevel: string;
            role: string;
        };
    }>;
    refresh(req: Request, res: Response): Promise<{
        user: {
            email: string;
            userId: string;
            profileCompleted: boolean;
            membershipLevel: string;
            role: string;
        };
    }>;
    logout(req: Request, res: Response): Promise<void>;
    me(req: Request): Promise<{
        userId: string;
        email: string;
        profileCompleted: boolean;
        membershipLevel: string;
        role: string;
        completedSections: string[];
    }>;
    private setTokenCookies;
    private clearTokenCookies;
}
