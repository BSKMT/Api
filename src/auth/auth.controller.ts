import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { UsersService } from "../users/users.service";
import { SessionGuard } from "./session.guard";

interface AuthenticatedUser {
  userId: string;
  email: string;
  role: string;
}

interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}

/**
 * AuthController — custom business-data endpoint.
 *
 * Better Auth's core auth endpoints (sign-up, sign-in, sign-out,
 * refresh, reset-password, verify-email, etc.) are handled directly
 * by the Better Auth handler mounted in `main.ts` at `/api/auth/*`.
 *
 * This controller only exposes the custom `/me` endpoint that
 * returns business data (membership, profile, role) from the
 * Mongoose `users` collection.
 */
@Controller("auth")
export class AuthController {
  constructor(private readonly usersService: UsersService) {}

  @UseGuards(SessionGuard)
  @Get("me")
  async me(@Req() req: AuthenticatedRequest) {
    const user = req.user;
    const fullUser = await this.usersService.findById(user.userId);
    return {
      userId: user.userId,
      email: user.email,
      emailVerified: fullUser?.emailVerified ?? false,
      phone: fullUser?.phone ?? null,
      phoneVerified: fullUser?.phoneVerified ?? false,
      pendingPhone: fullUser?.pendingPhone ?? null,
      pendingEmail: fullUser?.pendingEmail ?? null,
      profileCompleted: fullUser?.profileCompleted ?? false,
      identityVerified: fullUser?.identityVerified ?? false,
      membershipLevel: fullUser?.membershipLevel ?? null,
      membershipExpired: fullUser?.membershipExpired ?? true,
      membershipExpiryDate: fullUser?.membershipExpiryDate ?? null,
      membershipStartDate: fullUser?.membershipStartDate ?? null,
      membershipPaymentPlan: fullUser?.membershipPaymentPlan ?? null,
      role: fullUser?.role ?? "user",
      completedSections: fullUser?.completedSections ?? [],
      profile: fullUser?.profile ?? {},
    };
  }
}
