import {
  Controller,
  Get,
  Put,
  Delete,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { UpdateProfileSectionDto } from './dto/update-profile-section.dto';
import { DeleteProfileSectionDto } from './dto/delete-profile-section.dto';

@Controller('profile')
@UseGuards(JwtAuthGuard)
export class ProfileController {
  constructor(private usersService: UsersService) {}

  @Get()
  async getProfile(@Req() req: Request) {
    const user = req.user as { userId: string };
    const fullUser = await this.usersService.findById(user.userId);
    if (!fullUser)
      return { profile: {}, completedSections: [], profileCompleted: false };

    return {
      profile: fullUser.profile ?? {},
      completedSections: fullUser.completedSections ?? [],
      profileCompleted: fullUser.profileCompleted,
      membershipLevel: fullUser.membershipLevel,
      role: fullUser.role,
      email: fullUser.email,
    };
  }

  @Put()
  async updateSection(
    @Req() req: Request,
    @Body() dto: UpdateProfileSectionDto,
  ) {
    const user = req.user as { userId: string };
    const updated = await this.usersService.updateProfileSection(
      user.userId,
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
    @Req() req: Request,
    @Body() dto: DeleteProfileSectionDto,
  ) {
    const user = req.user as { userId: string };
    const updated = await this.usersService.deleteProfileSection(
      user.userId,
      dto.sectionId,
    );
    return {
      sectionId: dto.sectionId,
      completedSections: updated.completedSections,
      profileCompleted: updated.profileCompleted,
    };
  }
}
