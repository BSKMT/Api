import type { Request } from 'express';
import { UsersService } from '../users/users.service';
export declare class PanelController {
    private usersService;
    constructor(usersService: UsersService);
    getPanel(req: Request): Promise<{
        user: null;
        metrics: never[];
        session: {};
        benefits: never[];
        shortcuts?: undefined;
        modules?: undefined;
        profile?: undefined;
    } | {
        user: {
            userId: string;
            email: string;
            displayName: string;
            membershipLevel: string;
            role: string;
            profileCompleted: boolean;
        };
        metrics: {
            label: string;
            value: string;
            icon: string;
        }[];
        session: {
            accountStatus: string;
            accountVerified: boolean;
            supportPriority: string;
            membershipLevel: string;
            profileCompleted: boolean;
            completedSectionsCount: number;
            totalSections: number;
        };
        benefits: {
            tier: string;
            value: string;
            detail: string;
            accent: string;
            current: boolean;
        }[];
        shortcuts: {
            label: string;
            href: string;
            icon: string;
        }[];
        modules: {
            title: string;
            status: string;
            icon: string;
            summary: string;
            bullets: string[];
        }[];
        profile: {
            personal: Record<string, unknown>;
            contact: Record<string, unknown>;
            motorcycle: Record<string, unknown>;
            totalMotos: number;
        };
    }>;
}
