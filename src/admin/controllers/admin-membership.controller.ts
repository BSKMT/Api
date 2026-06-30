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
import { AdminMembershipService } from "../services/admin-membership.service";
import { RejectRefundDto } from "../dto/reject-refund.dto";
import { ExtendMembershipDto } from "../dto/extend-membership.dto";

@Controller("admin/membership")
@UseGuards(SessionGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminMembershipController {
  constructor(
    private readonly adminMembershipService: AdminMembershipService,
  ) {}

  @Get("transactions")
  async listTransactions(
    @Query("status") status?: string,
    @Query("userId") userId?: string,
    @Query("isRenewal") isRenewal?: string,
    @Query("limit") limit?: string,
    @Query("page") page?: string,
  ) {
    return this.adminMembershipService.listTransactions({
      status,
      userId,
      isRenewal: isRenewal === undefined ? undefined : isRenewal === "true",
      limit: limit ? parseInt(limit, 10) : 50,
      page: page ? parseInt(page, 10) : 1,
    });
  }

  @Get("transactions/:reference")
  async getTransaction(@Param("reference") reference: string) {
    return this.adminMembershipService.getTransaction(reference);
  }

  @Get("members")
  async listMembers(
    @Query("status") status?: "active" | "expired" | "user",
    @Query("limit") limit?: string,
    @Query("page") page?: string,
  ) {
    return this.adminMembershipService.listMembers({
      status,
      limit: limit ? parseInt(limit, 10) : 50,
      page: page ? parseInt(page, 10) : 1,
    });
  }

  @Get("members/:userId")
  async getMember(@Param("userId") userId: string) {
    return this.adminMembershipService.getMember(userId);
  }

  @Post("members/:userId/activate")
  @HttpCode(HttpStatus.OK)
  async activate(@Param("userId") userId: string) {
    return this.adminMembershipService.activateMembership(userId);
  }

  @Post("members/:userId/extend")
  @HttpCode(HttpStatus.OK)
  async extend(
    @Param("userId") userId: string,
    @Body() dto: ExtendMembershipDto,
  ) {
    return this.adminMembershipService.extendMembership(
      userId,
      dto.unit,
      dto.amount ?? 1,
      dto.baseDate,
    );
  }

  @Post("members/:userId/revoke")
  @HttpCode(HttpStatus.OK)
  async revoke(@Param("userId") userId: string) {
    return this.adminMembershipService.revokeMembership(userId);
  }

  @Get("refunds")
  async listPendingRefunds() {
    return this.adminMembershipService.listPendingRefunds();
  }

  @Post("refunds/:userId/approve")
  @HttpCode(HttpStatus.OK)
  async approveRefund(@Param("userId") userId: string) {
    return this.adminMembershipService.approveRefund(userId);
  }

  @Post("refunds/:userId/reject")
  @HttpCode(HttpStatus.OK)
  async rejectRefund(
    @Param("userId") userId: string,
    @Body() dto: RejectRefundDto,
  ) {
    return this.adminMembershipService.rejectRefund(userId, dto.reason);
  }
}
