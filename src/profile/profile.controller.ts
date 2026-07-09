import {
  Controller,
  Get,
  Put,
  Delete,
  Post,
  Body,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import { SessionGuard } from "../auth/session.guard";
import { UsersService } from "../users/users.service";
import { UpdateProfileSectionDto } from "./dto/update-profile-section.dto";
import { DeleteProfileSectionDto } from "./dto/delete-profile-section.dto";
import { REQUIRED_PROFILE_SECTIONS } from "../users/schemas/user.schema";

interface AuthenticatedRequest extends Request {
  user: { userId: string };
}

@Controller("profile")
@UseGuards(SessionGuard)
export class ProfileController {
  constructor(private readonly usersService: UsersService) {}

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
}
