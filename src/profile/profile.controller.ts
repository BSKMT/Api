import {
  Controller,
  Get,
  Put,
  Delete,
  Post,
  Body,
  Req,
  Param,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import { SessionGuard } from "../auth/session.guard";
import { UsersService } from "../users/users.service";
import { UpdateProfileSectionDto } from "./dto/update-profile-section.dto";
import { DeleteProfileSectionDto } from "./dto/delete-profile-section.dto";
import {
  InitiatePhoneVerifyDto,
  CheckPhoneVerifyDto,
  InitiateEmailChangeDto,
  CheckEmailChangeDto,
} from "./dto/verify-channel.dto";
import { ChannelVerificationService } from "./channel-verification.service";
import { REQUIRED_PROFILE_SECTIONS } from "../users/schemas/user.schema";

interface AuthenticatedRequest extends Request {
  user: { userId: string };
}

@Controller("profile")
@UseGuards(SessionGuard)
export class ProfileController {
  constructor(
    private readonly usersService: UsersService,
    private readonly verificationService: ChannelVerificationService,
  ) {}

  @Get()
  async getProfile(@Req() req: AuthenticatedRequest) {
    const { userId } = req.user;
    const fullUser = await this.usersService.findById(userId);
    if (!fullUser)
      return {
        profile: {},
        completedSections: [],
        profileCompleted: false,
        totalSections: REQUIRED_PROFILE_SECTIONS.length,
      };

    return {
      profile: fullUser.profile ?? {},
      completedSections: fullUser.completedSections ?? [],
      profileCompleted: fullUser.profileCompleted,
      totalSections: REQUIRED_PROFILE_SECTIONS.length,
      membershipLevel: fullUser.membershipLevel,
      role: fullUser.role,
      email: fullUser.email,
      emailVerified: fullUser.emailVerified ?? false,
      identityVerified: fullUser.identityVerified ?? false,
      phone: fullUser.phone ?? null,
      phoneVerified: fullUser.phoneVerified ?? false,
      pendingPhone: fullUser.pendingPhone ?? null,
      pendingEmail: fullUser.pendingEmail ?? null,
      legalConsentAccepted: fullUser.legalConsentAccepted ?? false,
    };
  }

  @Post("legal-consent")
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  async acceptLegalConsent(@Req() req: AuthenticatedRequest) {
    const { userId } = req.user;
    const updated = await this.usersService.acceptLegalConsent(userId);
    return { legalConsentAccepted: updated.legalConsentAccepted };
  }

  @Put()
  async updateSection(
    @Req() req: AuthenticatedRequest,
    @Body() dto: UpdateProfileSectionDto,
  ) {
    const { userId } = req.user;
    const updated = await this.usersService.updateProfileSection(
      userId,
      dto.sectionId,
      dto.data,
    );
    return {
      sectionId: dto.sectionId,
      completedSections: updated.completedSections,
      profileCompleted: updated.profileCompleted,
    };
  }

  @Delete()
  async deleteSection(
    @Req() req: AuthenticatedRequest,
    @Body() dto: DeleteProfileSectionDto,
  ) {
    const { userId } = req.user;
    const updated = await this.usersService.deleteProfileSection(
      userId,
      dto.sectionId,
    );
    return {
      sectionId: dto.sectionId,
      completedSections: updated.completedSections,
      profileCompleted: updated.profileCompleted,
    };
  }

  // ── Friend requests ─────────────────────────────────────────────────

  @Get("friend-requests")
  async getFriendRequests(@Req() req: AuthenticatedRequest) {
    const user = await this.usersService.findById(req.user.userId);
    if (!user) return { requests: [] };
    const pending = (user.friendRequests ?? []).filter(
      (r) => r.status === "pending",
    );
    return { requests: pending };
  }

  @Post("friend-requests/:requestId/respond")
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async respondToFriendRequest(
    @Req() req: AuthenticatedRequest,
    @Param("requestId") requestId: string,
    @Body() body: { status: "accepted" | "declined" },
  ) {
    if (!body?.status || !["accepted", "declined"].includes(body.status)) {
      return { message: "Estado invalido" };
    }
    await this.usersService.respondToFriendRequest(
      req.user.userId,
      requestId,
      body.status,
    );
    return { message: `Solicitud ${body.status === "accepted" ? "aceptada" : "rechazada"}` };
  }

  // ── Phone (SMS) verification ───────────────────────────────────────

  @Post("verify-phone/initiate")
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  async initiatePhoneVerification(
    @Req() req: AuthenticatedRequest,
    @Body() dto: InitiatePhoneVerifyDto,
  ) {
    await this.verificationService.initiatePhoneVerification(
      req.user.userId,
      dto.phone,
    );
    return { message: "Codigo SMS enviado" };
  }

  @Post("verify-phone/verify")
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async verifyPhone(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CheckPhoneVerifyDto,
  ) {
    await this.verificationService.verifyPhone(
      req.user.userId,
      dto.phone,
      dto.code,
    );
    return { message: "Telefono verificado", phoneVerified: true };
  }

  // ── Email change verification ───────────────────────────────────────

  @Post("change-email/initiate")
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  async initiateEmailChange(
    @Req() req: AuthenticatedRequest,
    @Body() dto: InitiateEmailChangeDto,
  ) {
    await this.verificationService.initiateEmailChange(
      req.user.userId,
      dto.newEmail,
    );
    return { message: "Codigo de verificacion enviado al nuevo correo" };
  }

  @Post("change-email/verify")
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async verifyEmailChange(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CheckEmailChangeDto,
  ) {
    await this.verificationService.verifyEmailChange(
      req.user.userId,
      dto.newEmail,
      dto.code,
    );
    return { message: "Correo actualizado y verificado", emailVerified: true };
  }
}
