import {
  Controller,
  Get,
  Post,
  Param,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import { SessionGuard } from "../../auth/session.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles, Role } from "../../common/decorators";
import { AdminSettingsService } from "../services/admin-settings.service";
import { ParseObjectIdPipe } from "../../common/pipes/parse-object-id.pipe";

interface AuthenticatedRequest extends Request {
  user: { userId: string; email?: string };
}

@Controller("admin/settings")
@UseGuards(SessionGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminSettingsController {
  constructor(private readonly adminSettingsService: AdminSettingsService) {}

  @Get("deletions")
  async listDeletionRequests() {
    return this.adminSettingsService.listDeletionRequests();
  }

  @Post("deletions/:userId/approve")
  @Throttle({ medium: { ttl: 60000, limit: 10 } })
  @HttpCode(HttpStatus.OK)
  async approveDeletion(@Req() req: AuthenticatedRequest, @Param("userId", ParseObjectIdPipe) userId: string) {
    return this.adminSettingsService.approveDeletion(userId, req.user.userId);
  }

  @Post("deletions/:userId/reject")
  @Throttle({ medium: { ttl: 60000, limit: 10 } })
  @HttpCode(HttpStatus.OK)
  async rejectDeletion(@Req() req: AuthenticatedRequest, @Param("userId", ParseObjectIdPipe) userId: string) {
    return this.adminSettingsService.rejectDeletion(userId, req.user.userId);
  }
}
