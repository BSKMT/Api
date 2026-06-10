import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { ConfigService } from "@nestjs/config";
import { Model } from "mongoose";
import * as crypto from "crypto";
import {
  Transaction,
  TransactionDocument,
} from "./schemas/transaction.schema";
import { CreatePaymentDto } from "./dto/create-payment.dto";
import { SubmitCompanionDto } from "./dto/submit-companion.dto";
import type { EnvironmentConfig } from "../config/config.interface";

const TIER_PRICING: Record<string, number> = {
  "member-solo": 0,
  "member-companion": 190000,
  "non-member-solo": 585000,
  "non-member-companion": 775000,
};

const TIER_DESCRIPTIONS: Record<string, string> = {
  "member-solo": "Inscripción RRF Training BSKMT - Miembro (Solo)",
  "member-companion":
    "Inscripción RRF Training BSKMT - Miembro (Con acompañante)",
  "non-member-solo": "Inscripción RRF Training BSKMT - No Miembro (Solo)",
  "non-member-companion":
    "Inscripción RRF Training BSKMT - No Miembro (Con acompañante)",
};

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectModel(Transaction.name)
    private transactionModel: Model<TransactionDocument>,
    private configService: ConfigService<EnvironmentConfig>,
  ) {}

  async createPayment(userId: string, dto: CreatePaymentDto) {
    const amount = TIER_PRICING[dto.tier];
    if (amount === undefined) {
      throw new BadRequestException("Tier de pago inválido");
    }

    const hasCompanion =
      dto.tier === "member-companion" || dto.tier === "non-member-companion";

    const timestamp = Date.now();
    const shortUserId = userId.slice(-8);
    const eventPrefix = dto.eventSlug.split("-")[0].toUpperCase();
    const reference = `${eventPrefix}-2026-${shortUserId}-${timestamp}`;

    const transaction = new this.transactionModel({
      userId,
      eventSlug: dto.eventSlug,
      reference,
      amount,
      description: TIER_DESCRIPTIONS[dto.tier],
      status: "PENDING",
      tier: dto.tier,
      hasCompanion,
    });

    await transaction.save();

    if (amount === 0) {
      transaction.status = "APPROVED";
      await transaction.save();
      this.logger.log(
        `Free tier payment auto-approved: ${reference} for user ${userId}`,
      );
      return {
        reference,
        amount,
        status: "APPROVED",
        requiresPayment: false,
      };
    }

    const boldEnvironment = this.configService.get("BOLD_ENVIRONMENT", {
      infer: true,
    })!;
    const boldPublicKey = this.configService.get("BOLD_PUBLIC_KEY", {
      infer: true,
    })!;
    const boldIdentityKey = this.configService.get("BOLD_IDENTITY_KEY", {
      infer: true,
    })!;

    const boldBaseUrl =
      boldEnvironment === "production"
        ? "https://payments.api.bold.co"
        : "https://payments-api-test.bold.co";

    this.logger.log(
      `Payment intent created: ${reference} for user ${userId}, amount: ${amount} COP`,
    );

    return {
      reference,
      amount,
      status: "PENDING",
      requiresPayment: true,
      boldConfig: {
        publicKey: boldPublicKey,
        identityKey: boldIdentityKey,
        environment: boldEnvironment,
        baseUrl: boldBaseUrl,
        referenceId: reference,
        description: TIER_DESCRIPTIONS[dto.tier],
        amount,
        currency: "COP",
      },
    };
  }

  async handleWebhook(
    rawBody: Buffer,
    signature: string,
  ): Promise<void> {
    const secretKey = this.configService.get("BOLD_SECRET_KEY", {
      infer: true,
    })!;

    const bodyBase64 = rawBody.toString("base64");
    const expectedSignature = crypto
      .createHmac("sha256", secretKey)
      .update(bodyBase64)
      .digest("hex");

    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);

    if (
      signatureBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
    ) {
      this.logger.warn("Invalid webhook signature received");
      throw new BadRequestException("Invalid signature");
    }

    const event = JSON.parse(rawBody.toString("utf-8")) as Record<
      string,
      unknown
    >;
    const paymentId = event["paymentId"] as string | undefined;
    const referenceId = event["referenceId"] as string | undefined;
    const eventType = event["type"] as string | undefined;

    if (!referenceId) {
      this.logger.warn("Webhook received without referenceId");
      return;
    }

    const transaction = await this.transactionModel.findOne({
      reference: referenceId,
    });

    if (!transaction) {
      this.logger.warn(
        `Webhook received for unknown reference: ${referenceId}`,
      );
      return;
    }

    const alreadyProcessed = transaction.webhookEvents.some(
      (e) =>
        paymentId !== undefined &&
        e.data["paymentId"] === paymentId &&
        e.type === eventType,
    );

    if (alreadyProcessed) {
      this.logger.log(
        `Duplicate webhook ignored for paymentId: ${paymentId}, reference: ${referenceId}`,
      );
      return;
    }

    transaction.webhookEvents.push({
      type: eventType ?? "UNKNOWN",
      receivedAt: new Date(),
      data: event,
    });

    if (paymentId && !transaction.boldPaymentId) {
      transaction.boldPaymentId = paymentId;
    }

    switch (eventType) {
      case "PAYMENT_APPROVED":
        transaction.status = "APPROVED";
        if (event["paymentMethod"]) {
          transaction.paymentMethod = event["paymentMethod"] as string;
        }
        if (event["payerEmail"]) {
          transaction.payerEmail = event["payerEmail"] as string;
        }
        break;
      case "PAYMENT_REJECTED":
        transaction.status = "REJECTED";
        break;
      case "PAYMENT_VOIDED":
        transaction.status = "VOIDED";
        break;
      case "PAYMENT_FAILED":
        transaction.status = "FAILED";
        break;
      case "PAYMENT_PROCESSING":
        transaction.status = "PROCESSING";
        break;
      default:
        this.logger.log(
          `Unhandled webhook event type: ${eventType} for reference: ${referenceId}`,
        );
    }

    await transaction.save();
    this.logger.log(
      `Webhook processed: ${eventType} for reference: ${referenceId}`,
    );
  }

  async getTransactionStatus(userId: string, reference: string) {
    const transaction = await this.transactionModel.findOne({
      userId,
      reference,
    });

    if (!transaction) {
      throw new NotFoundException("Transacción no encontrada");
    }

    return {
      reference: transaction.reference,
      status: transaction.status,
      amount: transaction.amount,
      tier: transaction.tier,
      boldPaymentId: transaction.boldPaymentId,
      paymentMethod: transaction.paymentMethod,
      createdAt: transaction.createdAt,
      updatedAt: transaction.updatedAt,
    };
  }

  async submitCompanionData(
    userId: string,
    reference: string,
    dto: SubmitCompanionDto,
  ) {
    const transaction = await this.transactionModel.findOne({
      userId,
      reference,
    });

    if (!transaction) {
      throw new NotFoundException("Transacción no encontrada");
    }

    if (!transaction.hasCompanion) {
      throw new BadRequestException(
        "Esta transacción no incluye acompañante",
      );
    }

    if (transaction.companionData) {
      throw new ConflictException(
        "Los datos del acompañante ya fueron registrados",
      );
    }

    transaction.companionData = {
      fullName: dto.fullName,
      documentId: dto.documentId,
      phone: dto.phone,
      email: dto.email,
    };

    await transaction.save();
    this.logger.log(
      `Companion data submitted for reference: ${reference}`,
    );

    return { message: "Datos del acompañante registrados exitosamente" };
  }

  async getTransactionsByUser(userId: string) {
    const transactions = await this.transactionModel
      .find({ userId })
      .sort({ createdAt: -1 })
      .select("-webhookEvents -__v");

    return transactions.map((t) => ({
      reference: t.reference,
      eventSlug: t.eventSlug,
      status: t.status,
      amount: t.amount,
      description: t.description,
      tier: t.tier,
      hasCompanion: t.hasCompanion,
      companionData: t.companionData,
      paymentMethod: t.paymentMethod,
      createdAt: t.createdAt,
    }));
  }
}
