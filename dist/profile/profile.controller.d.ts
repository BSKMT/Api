import type { Request } from 'express';
import { UsersService } from '../users/users.service';
import { UpdateProfileSectionDto } from './dto/update-profile-section.dto';
import { DeleteProfileSectionDto } from './dto/delete-profile-section.dto';
export declare class ProfileController {
    private usersService;
    constructor(usersService: UsersService);
    getProfile(req: Request): Promise<{
        profile: {};
        completedSections: never[];
        profileCompleted: boolean;
        membershipLevel?: undefined;
        role?: undefined;
        email?: undefined;
    } | {
        profile: Record<string, Record<string, unknown>>;
        completedSections: string[];
        profileCompleted: boolean;
        membershipLevel: string;
        role: string;
        email: string;
    }>;
    updateSection(req: Request, dto: UpdateProfileSectionDto): Promise<{
        sectionId: string;
        completedSections: string[];
        profileCompleted: boolean;
    }>;
    deleteSection(req: Request, dto: DeleteProfileSectionDto): Promise<{
        sectionId: string;
        completedSections: string[];
        profileCompleted: boolean;
    }>;
}
