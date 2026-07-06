import {
  Controller,
  Get,
  Put,
  Post,
  Delete,
  Body,
  Req,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { SettingsService } from "./settings.service";
import { SessionGuard } from "../auth/session.guard";
import { UpdateSettingsDto } from "./dto/update-settings.dto";
import {
  ChangePasswordDto,
  EnableTwoFactorDto,
  VerifyTwoFactorDto,
  DisableTwoFactorDto,
} from "./dto/security.dto";
import { DeleteAccountDto } from "./dto/delete-account.dto";
import { getAuth } from "../auth/better-auth";

function getCurrentToken(req: Request): string {
  const cookies = req.headers.cookie ?? "";
  const match = cookies.match(/better-auth\.session_token=([^;]+)/);
  return match ? match[1] : "";
}

@Controller("settings")
@UseGuards(SessionGuard)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  async getSettings(@Req() req: Request) {
    const user = (req as Request & { user: { userId: string } }).user;
    return this.settingsService.getSettings(user.userId);
  }

  @Put()
  async updateSettings(@Req() req: Request, @Body() dto: UpdateSettingsDto) {
    const user = (req as Request & { user: { userId: string } }).user;
    return this.settingsService.updateSettings(
      user.userId,
      dto as unknown as Record<string, unknown>,
    );
  }

  @Get("sessions")
  async getSessions(@Req() req: Request) {
    const user = (req as Request & { user: { userId: string; email: string } })
      .user;
    const token = getCurrentToken(req);
    return this.settingsService.getSessions(user.userId, user.email, token);
  }

  @Delete("sessions/:token")
  @HttpCode(HttpStatus.OK)
  async revokeSession(@Param("token") token: string) {
    return this.settingsService.revokeSession(token);
  }

  @Delete("sessions")
  @HttpCode(HttpStatus.OK)
  async revokeAllOtherSessions(@Req() req: Request) {
    const user = (req as Request & { user: { userId: string; email: string } })
      .user;
    const token = getCurrentToken(req);
    return this.settingsService.revokeAllOtherSessions(user.email, token);
  }

  @Post("change-password")
  @HttpCode(HttpStatus.OK)
  async changePassword(@Req() req: Request, @Body() dto: ChangePasswordDto) {
    return this.settingsService.changePassword(
      req,
      dto.currentPassword,
      dto.newPassword,
    );
  }

  @Get("2fa-status")
  async getTwoFactorStatus(@Req() req: Request) {
    const auth = await getAuth();
    const session = await auth.api.getSession({
      headers: req.headers,
    });
    return {
      enabled: Boolean(session?.user?.twoFactorEnabled),
    };
  }

  @Post("2fa/enable")
  @HttpCode(HttpStatus.OK)
  async enableTwoFactor(@Req() req: Request, @Body() dto: EnableTwoFactorDto) {
    return this.settingsService.enableTwoFactor(req, dto.password);
  }

  @Post("2fa/verify")
  @HttpCode(HttpStatus.OK)
  async verifyTwoFactor(@Req() req: Request, @Body() dto: VerifyTwoFactorDto) {
    return this.settingsService.verifyTwoFactor(req, dto.code);
  }

  @Post("2fa/disable")
  @HttpCode(HttpStatus.OK)
  async disableTwoFactor(
    @Req() req: Request,
    @Body() dto: DisableTwoFactorDto,
  ) {
    return this.settingsService.disableTwoFactor(req, dto.password);
  }

  @Post("delete-account")
  @HttpCode(HttpStatus.OK)
  async requestDeletion(@Req() req: Request, @Body() dto: DeleteAccountDto) {
    const user = (req as Request & { user: { userId: string } }).user;
    return this.settingsService.requestAccountDeletion(user.userId, dto.reason);
  }

  @Delete("delete-account")
  async cancelDeletion(@Req() req: Request) {
    const user = (req as Request & { user: { userId: string } }).user;
    return this.settingsService.cancelDeletionRequest(user.userId);
  }

  @Get("deletion-status")
  async deletionStatus(@Req() req: Request) {
    const user = (req as Request & { user: { userId: string } }).user;
    return this.settingsService.getDeletionStatus(user.userId);
  }

  @Get("data-export")
  async exportData(@Req() req: Request, @Res() res: Response) {
    const user = (req as Request & { user: { userId: string } }).user;
    const data = await this.settingsService.exportUserData(user.userId);
    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="bskmt-data-export-${Date.now()}.json"`,
    );
    res.json(data);
  }
}
