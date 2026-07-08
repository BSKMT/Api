import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
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
import { AdminMembershipService } from "../services/admin-membership.service";
import { RejectRefundDto } from "../dto/reject-refund.dto";
import { ExtendMembershipDto } from "../dto/extend-membership.dto";
import { ParseObjectIdPipe } from "../../common/pipes/parse-object-id.pipe";

interface AuthenticatedRequest extends Request {
  user: { userId: string; email?: string };
}

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
      limit: limit ? Number.parseInt(limit, 10) : 50,
      page: page ? Number.parseInt(page, 10) : 1,
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
      limit: limit ? Number.parseInt(limit, 10) : 50,
      page: page ? Number.parseInt(page, 10) : 1,
    });
  }

  @Get("members/:userId")
  async getMember(@Param("userId", ParseObjectIdPipe) userId: string) {
    return this.adminMembershipService.getMember(userId);
  }

  @Post("members/:userId/activate")
  @Throttle({ medium: { ttl: 60000, limit: 10 } })
  @HttpCode(HttpStatus.OK)
  async activate(@Req() req: AuthenticatedRequest, @Param("userId", ParseObjectIdPipe) userId: string) {
    return this.adminMembershipService.activateMembership(userId, req.user.userId);
  }

  @Post("members/:userId/extend")
  @Throttle({ medium: { ttl: 60000, limit: 10 } })
  @HttpCode(HttpStatus.OK)
  async extend(
    @Req() req: AuthenticatedRequest,
    @Param("userId", ParseObjectIdPipe) userId: string,
    @Body() dto: ExtendMembershipDto,
  ) {
    return this.adminMembershipService.extendMembership(
      userId,
      dto.unit,
      dto.amount ?? 1,
      dto.baseDate,
      req.user.userId,
    );
  }

  @Post("members/:userId/revoke")
  @Throttle({ medium: { ttl: 60000, limit: 10 } })
  @HttpCode(HttpStatus.OK)
  async revoke(@Req() req: AuthenticatedRequest, @Param("userId", ParseObjectIdPipe) userId: string) {
    return this.adminMembershipService.revokeMembership(userId, req.user.userId);
  }

  @Get("refunds")
  async listPendingRefunds() {
    return this.adminMembershipService.listPendingRefunds();
  }

  @Post("refunds/:userId/approve")
  @Throttle({ medium: { ttl: 60000, limit: 10 } })
  @HttpCode(HttpStatus.OK)
  async approveRefund(@Req() req: AuthenticatedRequest, @Param("userId", ParseObjectIdPipe) userId: string) {
    return this.adminMembershipService.approveRefund(userId, req.user.userId);
  }

  @Post("refunds/:userId/reject")
  @Throttle({ medium: { ttl: 60000, limit: 10 } })
  @HttpCode(HttpStatus.OK)
  async rejectRefund(
    @Req() req: AuthenticatedRequest,
    @Param("userId", ParseObjectIdPipe) userId: string,
    @Body() dto: RejectRefundDto,
  ) {
    return this.adminMembershipService.rejectRefund(userId, dto.reason, req.user.userId);
  }
}
