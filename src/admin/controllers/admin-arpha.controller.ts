import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { SessionGuard } from "../../auth/session.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles, Role } from "../../common/decorators";
import { AdminArphaService } from "../services/admin-arpha.service";
import { AssignArphaRequestDto } from "../dto/assign-arpha-request.dto";
import { UpdateArphaStatusDto } from "../dto/update-arpha-status.dto";

@Controller("admin/arpha")
@UseGuards(SessionGuard, RolesGuard)
@Roles(Role.ADMIN, Role.MODERATOR, Role.ROAD_CAPTAIN)
export class AdminArphaController {
  constructor(private readonly adminArphaService: AdminArphaService) {}

  @Get("requests")
  async list(
    @Query("status") status?: string,
    @Query("requestType") requestType?: string,
    @Query("limit") limit?: string,
    @Query("page") page?: string,
  ) {
    return this.adminArphaService.listRequests({
      status,
      requestType,
      limit: limit ? parseInt(limit, 10) : 50,
      page: page ? parseInt(page, 10) : 1,
    });
  }

  @Get("requests/:id")
  async getOne(@Param("id") id: string) {
    return this.adminArphaService.getRequest(id);
  }

  @Post("requests/:id/assign")
  @HttpCode(HttpStatus.OK)
  async assign(@Param("id") id: string, @Body() dto: AssignArphaRequestDto) {
    return this.adminArphaService.assignRequest(id, dto);
  }

  @Post("requests/:id/status")
  @HttpCode(HttpStatus.OK)
  async updateStatus(
    @Param("id") id: string,
    @Body() dto: UpdateArphaStatusDto,
  ) {
    return this.adminArphaService.updateStatus(id, dto);
  }
}
