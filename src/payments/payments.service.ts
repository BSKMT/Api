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
  WebhookEvent,
} from "./schemas/transaction.schema";
import { CreatePaymentDto } from "./dto/create-payment.dto";
import { SubmitCompanionDto } from "./dto/submit-companion.dto";
import { EventsService } from "../events/events.service";
import { ShopService } from "../shop/shop.service";
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

const EVENT_TIER_REFERENCE_PREFIX: Record<string, string> = {
  "member-solo": "MEM-EVT",
  "member-companion": "MEMC-EVT",
  "non-member-solo": "NM-EVT",
  "non-member-companion": "NMC-EVT",
};

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectModel(Transaction.name)
    private transactionModel: Model<TransactionDocument>,
    private configService: ConfigService<EnvironmentConfig>,
    private eventsService: EventsService,
    private shopService: ShopService,
  ) {}

  private generateBoldIntegritySignature(
    orderId: string,
    amount: number,
    currency: string,
  ): string {
    const secretKey =
      this.configService.get<string>("BOLD_SECRET_KEY", {
        infer: true,
      }) ?? "";
    const boldEnv =
      this.configService.get<string>("BOLD_ENVIRONMENT", {
        infer: true,
      }) ?? "sandbox";
    const effectiveSecretKey = boldEnv === "sandbox" ? "" : secretKey;
    const concatenated = `${orderId}${amount}${currency}${effectiveSecretKey}`;
    return crypto.createHash("sha256").update(concatenated).digest("hex");
  }

  async createPayment(userId: string, dto: CreatePaymentDto) {
    const purpose = dto.productSlug ? "shop" : "event";

    if (purpose === "shop") {
      return this.createShopPayment(userId, dto);
    }

    const amount = TIER_PRICING[dto.tier];
    if (amount === undefined) {
      throw new BadRequestException("Tier de pago inválido");
    }

    const hasCompanion =
      dto.tier === "member-companion" || dto.tier === "non-member-companion";

    const timestamp = Date.now();
    const shortUserId = userId.slice(-8);
    const eventPrefix = dto.eventSlug.split("-")[0].toUpperCase();
    const reference = `${EVENT_TIER_REFERENCE_PREFIX[dto.tier] ?? eventPrefix}-2026-${shortUserId}-${timestamp}`;

    const transaction = new this.transactionModel({
      userId,
      eventSlug: dto.eventSlug,
      reference,
      amount,
      description: TIER_DESCRIPTIONS[dto.tier],
      status: "PENDING",
      tier: dto.tier,
      hasCompanion,
      purpose: "event",
      relatedReference: null,
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
        integritySignature: this.generateBoldIntegritySignature(
          reference,
          amount,
          "COP",
        ),
      },
    };
  }

  private async createShopPayment(userId: string, dto: CreatePaymentDto) {
    if (!dto.productSlug) {
      throw new BadRequestException(
        "productSlug requerido para pagos de tienda",
      );
    }

    const amount = parseInt(dto.tier, 10);
    if (isNaN(amount) || amount < 0) {
      throw new BadRequestException("Monto de pago inválido");
    }

    const timestamp = Date.now();
    const shortUserId = userId.slice(-8);
    const reference = `SHOP-${shortUserId}-${timestamp}`;

    const transaction = new this.transactionModel({
      userId,
      eventSlug: dto.productSlug,
      reference,
      amount,
      description: `Compra Tienda BSK - ${dto.productSlug}`,
      status: "PENDING",
      tier: dto.tier,
      hasCompanion: false,
      purpose: "shop",
      relatedReference: dto.productSlug,
    });

    await transaction.save();

    if (amount === 0) {
      transaction.status = "APPROVED";
      await transaction.save();
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
      `Shop payment intent created: ${reference} for user ${userId}, amount: ${amount} COP`,
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
        description: `Compra Tienda BSK - ${dto.productSlug}`,
        amount,
        currency: "COP",
        integritySignature: this.generateBoldIntegritySignature(
          reference,
          amount,
          "COP",
        ),
      },
    };
  }

  async handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
    const boldEnv =
      this.configService.get("BOLD_ENVIRONMENT", {
        infer: true,
      }) ?? "sandbox";
    // Bold docs: in sandbox the HMAC must be computed with an empty secret.
    const secretKey =
      boldEnv === "sandbox"
        ? ""
        : (this.configService.get("BOLD_SECRET_KEY", { infer: true }) ?? "");

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
    const notificationId = event["id"] as string | undefined;
    const eventType = event["type"] as string | undefined;
    const data = (event["data"] ?? {}) as Record<string, unknown>;
    const metadata = (data["metadata"] ?? {}) as Record<string, unknown>;
    const paymentId = data["payment_id"] as string | undefined;
    const referenceId = metadata["reference"] as string | undefined;
    const paymentMethod = data["payment_method"] as string | undefined;
    const payerEmail = data["payer_email"] as string | undefined;

    if (!referenceId) {
      this.logger.warn("Webhook received without reference");
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

    const alreadyProcessed =
      notificationId !== undefined &&
      transaction.webhookEvents.some(
        (e) =>
          typeof e["notificationId"] === "string" &&
          e["notificationId"] === notificationId,
      );

    if (alreadyProcessed) {
      this.logger.log(
        `Duplicate webhook ignored: ${notificationId ?? paymentId}, ${referenceId}`,
      );
      return;
    }

    const webhookEvent = new WebhookEvent();
    webhookEvent.notificationId = notificationId ?? "UNKNOWN";
    webhookEvent.paymentId = paymentId ?? "UNKNOWN";
    webhookEvent.type = eventType ?? "UNKNOWN";
    webhookEvent.receivedAt = new Date();
    webhookEvent.data = event;
    transaction.webhookEvents.push(webhookEvent);

    if (paymentId && !transaction.boldPaymentId) {
      transaction.boldPaymentId = paymentId;
    }

    const statusFromEvent = this.mapBoldStatus(eventType);
    if (statusFromEvent) {
      transaction.status = statusFromEvent;
      if (statusFromEvent === "APPROVED") {
        if (paymentMethod) transaction.paymentMethod = paymentMethod;
        if (payerEmail) transaction.payerEmail = payerEmail;
      }
    } else {
      this.logger.log(
        `Unhandled webhook event type: ${eventType} for reference: ${referenceId}`,
      );
    }

    await transaction.save();
    this.logger.log(
      `Webhook processed: ${eventType} for reference: ${referenceId}`,
    );

    if (statusFromEvent === "APPROVED") {
      try {
        if (transaction.purpose === "shop" && transaction.relatedReference) {
          await this.shopService.linkOrderPayment(
            transaction.relatedReference,
            transaction.reference,
          );
          this.logger.log(
            `Shop order payment linked: order=${transaction.relatedReference} ref=${transaction.reference}`,
          );
        } else {
          await this.eventsService.linkPayment(
            transaction.userId,
            transaction.eventSlug,
            transaction.reference,
          );
          this.logger.log(
            `Event registration payment linked: user=${transaction.userId} event=${transaction.eventSlug}`,
          );
        }
      } catch (err: unknown) {
        this.logger.warn(
          `Failed to link payment: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  private mapBoldStatus(eventType: string | undefined): string | null {
    switch (eventType) {
      case "SALE_APPROVED":
      case "PAYMENT_APPROVED":
        return "APPROVED";
      case "SALE_REJECTED":
      case "PAYMENT_REJECTED":
        return "REJECTED";
      case "VOID_APPROVED":
      case "PAYMENT_VOIDED":
        return "VOIDED";
      case "VOID_REJECTED":
      case "PAYMENT_FAILED":
        return "FAILED";
      case "PAYMENT_PROCESSING":
        return "PROCESSING";
      default:
        return null;
    }
  }

  /**
   * Queries Bold's payment-voucher API for the real-time status of a
   * transaction. This is the recommended fallback when the webhook is not
   * received (Docs_Bold/pagos_en_linea/consulta_de_transacciones.md).
   *
   * Rate-limited via `lastBoldSyncAt` to at most one call every 10 seconds,
   * preventing excessive API requests during frontend polling.
   */
  private async syncWithBold(transaction: TransactionDocument): Promise<void> {
    const now = new Date();
    const minIntervalMs = 10_000;

    if (
      transaction.lastBoldSyncAt &&
      now.getTime() - new Date(transaction.lastBoldSyncAt).getTime() <
        minIntervalMs
    ) {
      return;
    }

    const boldEnv =
      this.configService.get<string>("BOLD_ENVIRONMENT", {
        infer: true,
      }) ?? "sandbox";
    const identityKey =
      this.configService.get<string>("BOLD_IDENTITY_KEY", {
        infer: true,
      }) ?? "";

    if (!identityKey) {
      this.logger.warn(
        "Cannot sync with Bold: BOLD_IDENTITY_KEY is not configured",
      );
      return;
    }

    const baseUrl =
      boldEnv === "production"
        ? "https://payments.api.bold.co"
        : "https://payments-api-test.bold.co";

    const url = `${baseUrl}/v2/payment-voucher/${encodeURIComponent(transaction.reference)}`;

    transaction.lastBoldSyncAt = now;
    await transaction.save();

    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `x-api-key ${identityKey}`,
          Accept: "application/json",
        },
      });

      if (!res.ok) {
        this.logger.warn(
          `Bold sync API returned ${res.status} for reference: ${transaction.reference}`,
        );
        return;
      }

      const body = (await res.json()) as Record<string, unknown>;
      const boldStatus = body["payment_status"] as string | undefined;

      if (!boldStatus || boldStatus === "NO_TRANSACTION_FOUND") {
        this.logger.log(
          `Bold sync: no transaction found yet for reference: ${transaction.reference}`,
        );
        return;
      }

      const mappedStatus = this.mapBoldVoucherStatus(boldStatus);
      if (!mappedStatus || mappedStatus === transaction.status) {
        return;
      }

      this.logger.log(
        `Bold sync: updating ${transaction.reference} from ${transaction.status} to ${mappedStatus}`,
      );

      transaction.status = mappedStatus;

      if (mappedStatus === "APPROVED") {
        const paymentMethod = body["payment_method"] as string | undefined;
        const payerEmail = body["payer_email"] as string | undefined;
        const boldPaymentId = body["transaction_id"] as string | undefined;
        if (paymentMethod) transaction.paymentMethod = paymentMethod;
        if (payerEmail) transaction.payerEmail = payerEmail;
        if (boldPaymentId && !transaction.boldPaymentId) {
          transaction.boldPaymentId = boldPaymentId;
        }
      }

      await transaction.save();

      if (mappedStatus === "APPROVED") {
        try {
          if (transaction.purpose === "shop" && transaction.relatedReference) {
            await this.shopService.linkOrderPayment(
              transaction.relatedReference,
              transaction.reference,
            );
            this.logger.log(
              `Shop order payment linked via sync: order=${transaction.relatedReference} ref=${transaction.reference}`,
            );
          } else {
            await this.eventsService.linkPayment(
              transaction.userId,
              transaction.eventSlug,
              transaction.reference,
            );
            this.logger.log(
              `Event registration payment linked via sync: user=${transaction.userId} event=${transaction.eventSlug}`,
            );
          }
        } catch (err: unknown) {
          this.logger.warn(
            `Failed to link payment after sync: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } catch (err: unknown) {
      this.logger.warn(
        `Bold sync failed for ${transaction.reference}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private mapBoldVoucherStatus(boldStatus: string): string | null {
    switch (boldStatus.toUpperCase()) {
      case "APPROVED":
        return "APPROVED";
      case "REJECTED":
        return "REJECTED";
      case "FAILED":
        return "FAILED";
      case "VOIDED":
        return "VOIDED";
      case "PROCESSING":
        return "PROCESSING";
      case "PENDING":
        return null;
      default:
        return null;
    }
  }

  async getTransactionStatus(userId: string, reference: string) {
    const transaction = await this.transactionModel.findOne({
      userId,
      reference,
    });

    if (!transaction) {
      throw new NotFoundException("Transacción no encontrada");
    }

    if (transaction.status === "PENDING" && transaction.amount > 0) {
      await this.syncWithBold(transaction);
    }

    const result: {
      reference: string;
      status: string;
      amount: number;
      tier: string;
      boldPaymentId: string | null;
      paymentMethod: string | null;
      createdAt: Date;
      updatedAt: Date;
      requiresPayment: boolean;
      boldConfig?: {
        publicKey: string;
        identityKey: string;
        environment: string;
        baseUrl: string;
        referenceId: string;
        description: string;
        amount: number;
        currency: string;
        integritySignature: string;
      };
    } = {
      reference: transaction.reference,
      status: transaction.status,
      amount: transaction.amount,
      tier: transaction.tier,
      boldPaymentId: transaction.boldPaymentId,
      paymentMethod: transaction.paymentMethod,
      createdAt: transaction.createdAt,
      updatedAt: transaction.updatedAt,
      requiresPayment: transaction.status === "PENDING",
    };

    if (transaction.status === "PENDING" && transaction.amount > 0) {
      const boldEnvironment =
        this.configService.get<string>("BOLD_ENVIRONMENT", {
          infer: true,
        }) ?? "sandbox";
      const boldPublicKey =
        this.configService.get<string>("BOLD_PUBLIC_KEY", {
          infer: true,
        }) ?? "";
      const boldIdentityKey =
        this.configService.get<string>("BOLD_IDENTITY_KEY", {
          infer: true,
        }) ?? "";
      const boldBaseUrl =
        boldEnvironment === "production"
          ? "https://payments.api.bold.co"
          : "https://payments-api-test.bold.co";

      result.boldConfig = {
        publicKey: boldPublicKey,
        identityKey: boldIdentityKey,
        environment: boldEnvironment,
        baseUrl: boldBaseUrl,
        referenceId: transaction.reference,
        description: transaction.description,
        amount: transaction.amount,
        currency: "COP",
        integritySignature: this.generateBoldIntegritySignature(
          transaction.reference,
          transaction.amount,
          "COP",
        ),
      };
    }

    return result;
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
      throw new BadRequestException("Esta transacción no incluye acompañante");
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
    this.logger.log(`Companion data submitted for reference: ${reference}`);

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
