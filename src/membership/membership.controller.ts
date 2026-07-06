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
} from "@nestjs/common";
import type { Request } from "express";
import { SessionGuard } from "../auth/session.guard";
import { MembershipService } from "./membership.service";
import { CreateMembershipPaymentDto } from "./dto/create-membership-payment.dto";
import { CreditChoiceDto } from "./dto/credit-choice.dto";
import { UseCreditDto } from "./dto/use-credit.dto";

interface AuthenticatedRequest extends Request {
  user: { userId: string };
}

@Controller("membership")
export class MembershipController {
  constructor(private readonly membershipService: MembershipService) {}

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

  @Post("webhook")
  @HttpCode(HttpStatus.OK)
  handleWebhook(
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

    void this.membershipService
      .handleWebhook(rawBody, signature)
      .catch((err: Error) => {
        console.error("Membership webhook error:", err.message);
      });

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
}
