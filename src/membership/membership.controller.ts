import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  Headers,
  BadRequestException,
} from "@nestjs/common";
import type { Request } from "express";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { SkipCsrf } from "../common/decorators";
import { MembershipService } from "./membership.service";
import { CreateMembershipPaymentDto } from "./dto/create-membership-payment.dto";

@Controller("membership")
export class MembershipController {
  constructor(private readonly membershipService: MembershipService) {}

  @UseGuards(JwtAuthGuard)
  @Post("purchase")
  @HttpCode(HttpStatus.CREATED)
  async createPayment(
    @Req() req: Request,
    @Body() dto: CreateMembershipPaymentDto,
  ) {
    const { userId } = req.user as { userId: string };
    return this.membershipService.createMembershipPayment(userId, dto);
  }

  @SkipCsrf()
  @Post("webhook")
  @HttpCode(HttpStatus.OK)
  handleWebhook(
    @Req() req: Request,
    @Headers("x-bold-signature") signature: string,
  ) {
    if (!signature) {
      throw new BadRequestException("Missing signature header");
    }

    const rawBody = req.body as Buffer;
    if (!Buffer.isBuffer(rawBody)) {
      throw new BadRequestException("Invalid request body");
    }

    void this.membershipService
      .handleWebhook(rawBody, signature)
      .catch((err: Error) => {
        console.error("Membership webhook error:", err.message);
      });

    return { received: true };
  }

  @UseGuards(JwtAuthGuard)
  @Get("status")
  async getStatus(@Req() req: Request) {
    const { userId } = req.user as { userId: string };
    return this.membershipService.getMembershipStatus(userId);
  }
}
