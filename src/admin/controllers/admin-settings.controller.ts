import {
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { SessionGuard } from "../../auth/session.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles, Role } from "../../common/decorators";
import { AdminSettingsService } from "../services/admin-settings.service";

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
  @HttpCode(HttpStatus.OK)
  async approveDeletion(@Param("userId") userId: string) {
    return this.adminSettingsService.approveDeletion(userId);
  }

  @Post("deletions/:userId/reject")
  @HttpCode(HttpStatus.OK)
  async rejectDeletion(@Param("userId") userId: string) {
    return this.adminSettingsService.rejectDeletion(userId);
  }
}
