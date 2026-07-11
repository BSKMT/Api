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
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { SettingsService } from "./settings.service";
import { SessionGuard } from "../auth/session.guard";
import { UpdateSettingsDto } from "./dto/update-settings.dto";
import { ChangePasswordDto } from "./dto/security.dto";
import { DeleteAccountDto } from "./dto/delete-account.dto";

function getCurrentToken(req: Request): string {
  const cookies = req.headers.cookie ?? "";
  const match = /better-auth\.session_token=([^;]+)/.exec(cookies);
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
    const user = (
      req as Request & {
        user: { userId: string; email: string; betterAuthId: string };
      }
    ).user;
    const token = getCurrentToken(req);
    return this.settingsService.getSessions(
      user.userId,
      user.betterAuthId,
      token,
    );
  }

  @Delete("sessions/:id")
  @HttpCode(HttpStatus.OK)
  async revokeSession(@Req() req: Request, @Param("id") id: string) {
    const user = (req as Request & { user: { betterAuthId: string } }).user;
    return this.settingsService.revokeSession(id, user.betterAuthId);
  }

  @Delete("sessions")
  @HttpCode(HttpStatus.OK)
  async revokeAllOtherSessions(@Req() req: Request) {
    const user = (req as Request & { user: { betterAuthId: string } }).user;
    const token = getCurrentToken(req);
    return this.settingsService.revokeAllOtherSessions(
      user.betterAuthId,
      token,
    );
  }

  @Post("change-password")
  @Throttle({ medium: { ttl: 60000, limit: 3 } })
  @HttpCode(HttpStatus.OK)
  async changePassword(@Req() req: Request, @Body() dto: ChangePasswordDto) {
    return this.settingsService.changePassword(
      req,
      dto.currentPassword,
      dto.newPassword,
    );
  }

  @Post("delete-account")
  @Throttle({ medium: { ttl: 60000, limit: 3 } })
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
  @Throttle({ medium: { ttl: 60000, limit: 3 } })
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
