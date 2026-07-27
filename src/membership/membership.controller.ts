import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  Headers,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request } from "express";
import { SessionGuard } from "../auth/session.guard";
import { MembershipService } from "./membership.service";
import { CreateMembershipPaymentDto } from "./dto/create-membership-payment.dto";
import { CreditChoiceDto } from "./dto/credit-choice.dto";
import { UseCreditDto } from "./dto/use-credit.dto";
import { Public } from "../common/decorators";
import type { EnvironmentConfig } from "../config/config.interface";

interface AuthenticatedRequest extends Request {
  user: { userId: string };
}

@Controller("membership")
export class MembershipController {
  private readonly logger = new Logger(MembershipController.name);

  constructor(
    private readonly membershipService: MembershipService,
    private readonly configService: ConfigService<EnvironmentConfig>,
  ) {}

  @UseGuards(SessionGuard)
  @Post("purchase")
  @HttpCode(HttpStatus.CREATED)
  async createPayment(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateMembershipPaymentDto,
  ) {
    const { userId } = req.user;
    return this.membershipService.createMembershipPayment(userId, dto);
  }

  @Public()
  @Post("webhook")
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Req() req: Request,
    @Headers("x-bold-signature") signature: string,
  ) {
    if (!signature) {
      throw new BadRequestException("Missing signature header");
    }

    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    if (!rawBody || !Buffer.isBuffer(rawBody)) {
      throw new BadRequestException("Invalid request body");
    }

    await this.membershipService.handleWebhook(rawBody, signature);

    return { received: true };
  }

  @UseGuards(SessionGuard)
  @Get("status")
  async getStatus(@Req() req: AuthenticatedRequest) {
    const { userId } = req.user;
    return this.membershipService.getMembershipStatus(userId);
  }

  @UseGuards(SessionGuard)
  @Get("payment/:reference")
  async getPayment(
    @Req() req: AuthenticatedRequest,
    @Param("reference") reference: string,
  ) {
    const { userId } = req.user;
    return this.membershipService.getMembershipPayment(userId, reference);
  }

  @UseGuards(SessionGuard)
  @Get("credit")
  async getCreditBalance(@Req() req: AuthenticatedRequest) {
    const { userId } = req.user;
    return this.membershipService.getCreditBalance(userId);
  }

  @UseGuards(SessionGuard)
  @Post("credit/choose")
  @HttpCode(HttpStatus.OK)
  async chooseCreditOption(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreditChoiceDto,
  ) {
    const { userId } = req.user;
    return this.membershipService.chooseCreditOption(userId, dto);
  }

  @UseGuards(SessionGuard)
  @Post("credit/use")
  @HttpCode(HttpStatus.OK)
  async useCredit(@Req() req: AuthenticatedRequest, @Body() dto: UseCreditDto) {
    const { userId } = req.user;
    return this.membershipService.useCredit(userId, dto);
  }

  @UseGuards(SessionGuard)
  @Post("credit/refund")
  @HttpCode(HttpStatus.OK)
  async requestRefund(@Req() req: AuthenticatedRequest) {
    const { userId } = req.user;
    return this.membershipService.requestRefund(userId);
  }

  /**
   * A-5: Sweeps abandoned PENDING membership transactions whose credit
   * block would otherwise never be released. Invoked by Vercel Cron
   * (see `vercel.json`). Authenticated via a shared secret header
   * (defense-in-depth); neither SessionGuard nor the CSRF origin
   * middleware apply (the global CSRF middleware exempts
   * `/api/membership/webhook` and all `/api/internal/cron/*` routes; we
   * additionally exempt this membership-cron route below, which sits
   * under a different prefix).
   */
  @Public()
  @Post("internal/cron/sweep-pending")
  @HttpCode(HttpStatus.OK)
  async sweepPending(
    @Headers("x-cron-secret") headerSecret: string | undefined,
    @Headers("authorization") authorization: string | undefined,
  ) {
    this.assertCronSecret(headerSecret, authorization);
    const startedAt = Date.now();
    const result = await this.membershipService.sweepAbandonedPayments();
    const elapsed = Date.now() - startedAt;
    this.logger.log(
      `sweep-pending cron completed in ${elapsed}ms — ${result.swept} swept`,
    );
    return { ok: true, ...result, elapsedMs: elapsed };
  }

  /**
   * Defense-in-depth secret check. Accepts either the dedicated
   * `X-Cron-Secret` header (explicit) or the Vercel-Cron-default
   * `Authorization: Bearer <secret>` header. Constant-time compare
   * prevents header-based timing side channels.
   */
  private assertCronSecret(
    headerSecret: string | undefined,
    authorization: string | undefined,
  ): void {
    const expected =
      this.configService.get<string>("CRON_SECRET", { infer: true }) ?? "";
    if (!expected) {
      throw new BadRequestException("CRON_SECRET not configured");
    }
    const provided =
      headerSecret ??
      (authorization && authorization.startsWith("Bearer ")
        ? authorization.slice("Bearer ".length)
        : undefined) ??
      "";
    if (provided.length !== expected.length || provided !== expected) {
      this.logger.warn(
        "Unauthorized cron invocation — secret mismatch (or missing).",
      );
      throw new BadRequestException("Invalid or missing cron secret");
    }
  }
}
