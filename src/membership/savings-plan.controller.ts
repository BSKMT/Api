import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import { SessionGuard } from "../auth/session.guard";
import { IdentityVerifiedGuard } from "../common/guards";
import { SavingsPlanService } from "./services/savings-plan.service";
import {
  RequestSavingsExtensionDto,
  RequestSavingsRefundDto,
  AppealSavingsRefundDto,
  EscalateSavingsLegalDto,
} from "./dto/savings-plan.dto";
import { ensureString } from "../common/utils/sanitize-query.util";

interface AuthenticatedRequest extends Request {
  user: { userId: string };
}

function validateOptionalYearQuery(raw?: unknown): void {
  const str = ensureString(raw);
  if (!str?.trim()) return;
  const parsed = Number.parseInt(str.trim(), 10);
  if (!Number.isInteger(parsed) || parsed < 2024 || parsed > 2035) {
    throw new BadRequestException(
      "El parámetro de año (year) debe estar entre 2024 y 2035.",
    );
  }
}

@Controller("membership/savings-plan")
export class SavingsPlanController {
  constructor(private readonly savingsPlanService: SavingsPlanService) {}

  @UseGuards(SessionGuard)
  @Get()
  async getSavingsPlan(
    @Req() req: AuthenticatedRequest,
    @Query("year") year?: unknown,
  ) {
    validateOptionalYearQuery(year);
    return this.savingsPlanService.getSavingsPlanSummary(req.user.userId);
  }

  @UseGuards(SessionGuard)
  @Get("complete-balance")
  async getCompleteBalanceContext(
    @Req() req: AuthenticatedRequest,
    @Query("year") year?: unknown,
  ) {
    validateOptionalYearQuery(year);
    return this.savingsPlanService.getCompleteBalanceContext(req.user.userId);
  }

  @UseGuards(SessionGuard)
  @Throttle({ medium: { ttl: 60000, limit: 10 } })
  @Post("request-extension")
  @HttpCode(HttpStatus.OK)
  async requestSavingsExtension(
    @Req() req: AuthenticatedRequest,
    @Body() dto: RequestSavingsExtensionDto,
  ) {
    return this.savingsPlanService.requestExtension(req.user.userId, dto);
  }

  @UseGuards(SessionGuard, IdentityVerifiedGuard)
  @Throttle({ medium: { ttl: 60000, limit: 5 } })
  @Post("refund-request")
  @HttpCode(HttpStatus.CREATED)
  async requestSavingsRefund(
    @Req() req: AuthenticatedRequest,
    @Body() dto: RequestSavingsRefundDto,
  ) {
    return this.savingsPlanService.requestRefund(req.user.userId, dto);
  }

  @UseGuards(SessionGuard, IdentityVerifiedGuard)
  @Throttle({ medium: { ttl: 60000, limit: 5 } })
  @Post("refund-appeal")
  @HttpCode(HttpStatus.OK)
  async appealSavingsRefund(
    @Req() req: AuthenticatedRequest,
    @Body() dto: AppealSavingsRefundDto,
  ) {
    return this.savingsPlanService.appealRefund(req.user.userId, dto);
  }

  @UseGuards(SessionGuard, IdentityVerifiedGuard)
  @Throttle({ medium: { ttl: 60000, limit: 5 } })
  @Post("refund-legal-escalation")
  @HttpCode(HttpStatus.OK)
  async escalateSavingsLegal(
    @Req() req: AuthenticatedRequest,
    @Body() dto: EscalateSavingsLegalDto,
  ) {
    return this.savingsPlanService.escalateToLegalCommittee(
      req.user.userId,
      dto,
    );
  }

  @UseGuards(SessionGuard)
  @Throttle({ medium: { ttl: 60000, limit: 5 } })
  @Post("reinstatement")
  @HttpCode(HttpStatus.OK)
  async reinstateMembership(@Req() req: AuthenticatedRequest) {
    return this.savingsPlanService.reinstateMembership(req.user.userId);
  }
}
