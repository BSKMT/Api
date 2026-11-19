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
  UnauthorizedException,
  Query,
} from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import type { Request } from "express";
import { PaymentsService } from "./payments.service";
import { CreatePaymentDto } from "./dto/create-payment.dto";
import { SubmitCompanionDto } from "./dto/submit-companion.dto";
import { SessionGuard } from "../auth/session.guard";
import { IdentityVerifiedGuard } from "../common/guards/identity-verified.guard";
import { Public } from "../common/decorators";
import { ensureString } from "../common/utils/sanitize-query.util";
import { ConfigService } from "@nestjs/config";
import type { EnvironmentConfig } from "../config/config.interface";

class WebhookBatchBodyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(65_536)
  rawBody!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  signature!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  source?: string;

  @IsOptional()
  enqueuedAt?: number;
}

class WebhookBatchItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  id!: string;

  @IsObject()
  @ValidateNested()
  @Type(() => WebhookBatchBodyDto)
  body!: WebhookBatchBodyDto;

  @IsOptional()
  timestamp?: string | number | Date;
}

class WebhookBatchPayloadDto {
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => WebhookBatchItemDto)
  batch!: WebhookBatchItemDto[];
}

interface AuthenticatedRequest extends Request {
  user: { userId: string };
}

@Controller("payments")
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly configService: ConfigService<EnvironmentConfig>,
  ) {}

  @UseGuards(SessionGuard, IdentityVerifiedGuard)
  @Post("create")
  @HttpCode(HttpStatus.CREATED)
  async createPayment(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreatePaymentDto,
  ) {
    const { userId } = req.user;
    return this.paymentsService.createPayment(userId, dto);
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

    await this.paymentsService.handleWebhook(rawBody, signature);

    return { received: true };
  }

  /**
   * Endpoint de ingesta por lotes invocado de forma segura por el consumidor de
   * Cloudflare Queues (bskmt-webhooks-queue).
   */
  @Public()
  @Post("webhook/batch")
  @HttpCode(HttpStatus.OK)
  async handleWebhookBatch(
    @Headers("x-edge-secret") edgeSecret: string | undefined,
    @Body() payload: WebhookBatchPayloadDto,
  ) {
    const expectedSecret = this.configService
      .get<string>("INTERNAL_EDGE_SECRET", {
        infer: true,
      })
      ?.trim();

    const providedBuf = Buffer.from(edgeSecret?.trim() ?? "", "utf8");
    const expectedBuf = Buffer.from(expectedSecret ?? "", "utf8");
    if (
      !expectedSecret ||
      providedBuf.length !== expectedBuf.length ||
      !timingSafeEqual(providedBuf, expectedBuf)
    ) {
      throw new UnauthorizedException(
        "Unauthorized edge webhook batch delivery",
      );
    }

    if (!payload?.batch || !Array.isArray(payload.batch)) {
      throw new BadRequestException("Invalid batch format");
    }

    const result = await this.paymentsService.handleWebhookBatch(payload.batch);
    return { received: true, ...result };
  }

  @UseGuards(SessionGuard)
  @Get("status/:reference")
  async getTransactionStatus(
    @Req() req: AuthenticatedRequest,
    @Param("reference") reference: string,
  ): Promise<Record<string, unknown>> {
    const { userId } = req.user;
    return this.paymentsService.getTransactionStatus(userId, reference);
  }

  @UseGuards(SessionGuard)
  @Post("companion/:reference")
  @HttpCode(HttpStatus.OK)
  async submitCompanionData(
    @Req() req: AuthenticatedRequest,
    @Param("reference") reference: string,
    @Body() dto: SubmitCompanionDto,
  ) {
    const { userId } = req.user;
    return this.paymentsService.submitCompanionData(userId, reference, dto);
  }

  @UseGuards(SessionGuard)
  @Get("my-transactions")
  async getMyTransactions(@Req() req: AuthenticatedRequest) {
    const { userId } = req.user;
    return this.paymentsService.getTransactionsByUser(userId);
  }

  @UseGuards(SessionGuard)
  @Post("cancel/:reference")
  @HttpCode(HttpStatus.OK)
  async cancelTransaction(
    @Req() req: AuthenticatedRequest,
    @Param("reference") reference: string,
  ) {
    const { userId } = req.user;
    return this.paymentsService.cancelPendingTransaction(userId, reference);
  }

  @UseGuards(SessionGuard)
  @Post("retry-invoice/:reference")
  @HttpCode(HttpStatus.OK)
  async retryInvoice(
    @Req() req: AuthenticatedRequest,
    @Param("reference") reference: string,
  ) {
    const { userId } = req.user;
    return this.paymentsService.retryInvoice(userId, reference);
  }

  @UseGuards(SessionGuard)
  @Get("invoice/:reference/pdf")
  async getInvoicePdf(
    @Req() req: AuthenticatedRequest,
    @Param("reference") reference: string,
    @Query("purpose") purpose?: string,
  ) {
    const { userId } = req.user;
    return this.paymentsService.getInvoicePdfUrl(
      userId,
      reference,
      ensureString(purpose),
    );
  }

  @UseGuards(SessionGuard)
  @Get("pending-check")
  async checkPending(
    @Req() req: AuthenticatedRequest,
    @Query("purpose") purpose: string,
    @Query("eventSlug") eventSlug?: string,
  ) {
    const { userId } = req.user;
    const safePurpose = ensureString(purpose);
    if (!safePurpose) {
      throw new BadRequestException("Parámetro purpose inválido");
    }
    return this.paymentsService.checkPendingForPurpose(
      userId,
      safePurpose,
      ensureString(eventSlug),
    );
  }
}
