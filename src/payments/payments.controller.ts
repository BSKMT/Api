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
import { PaymentsService } from "./payments.service";
import { CreatePaymentDto } from "./dto/create-payment.dto";
import { SubmitCompanionDto } from "./dto/submit-companion.dto";
import { SessionGuard } from "../auth/session.guard";

@Controller("payments")
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @UseGuards(SessionGuard)
  @Post("create")
  @HttpCode(HttpStatus.CREATED)
  async createPayment(@Req() req: Request, @Body() dto: CreatePaymentDto) {
    const { userId } = req.user as { userId: string };
    return this.paymentsService.createPayment(userId, dto);
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

    void this.paymentsService
      .handleWebhook(rawBody, signature)
      .catch((err: Error) => {
        console.error("Webhook processing error:", err.message);
      });

    return { received: true };
  }

  @UseGuards(SessionGuard)
  @Get("status/:reference")
  async getTransactionStatus(
    @Req() req: Request,
    @Param("reference") reference: string,
  ) {
    const { userId } = req.user as { userId: string };
    return this.paymentsService.getTransactionStatus(userId, reference);
  }

  @UseGuards(SessionGuard)
  @Post("companion/:reference")
  @HttpCode(HttpStatus.OK)
  async submitCompanionData(
    @Req() req: Request,
    @Param("reference") reference: string,
    @Body() dto: SubmitCompanionDto,
  ) {
    const { userId } = req.user as { userId: string };
    return this.paymentsService.submitCompanionData(userId, reference, dto);
  }

  @UseGuards(SessionGuard)
  @Get("my-transactions")
  async getMyTransactions(@Req() req: Request) {
    const { userId } = req.user as { userId: string };
    return this.paymentsService.getTransactionsByUser(userId);
  }
}
