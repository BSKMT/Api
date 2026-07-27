import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { ConfigService } from "@nestjs/config";
import { Model } from "mongoose";
import * as crypto from "node:crypto";
import {
  Transaction,
  TransactionDocument,
  WebhookEvent,
} from "./schemas/transaction.schema";
import { CreatePaymentDto } from "./dto/create-payment.dto";
import { SubmitCompanionDto } from "./dto/submit-companion.dto";
import { EventsService } from "../events/events.service";
import { ShopService } from "../shop/shop.service";
import { ArphaService } from "../arpha/arpha.service";
import { ARPHA_PRICING } from "../arpha/schemas/arpha-request.schema";
import { UsersService } from "../users/users.service";
import { UserRole } from "../users/schemas/user.schema";
import {
  maskUserId,
  maskReference,
  maskAmount,
} from "../common/utils/log-redact.util";
import type { EnvironmentConfig } from "../config/config.interface";

const EVENT_TIER_REFERENCE_PREFIX: Record<string, string> = {
  "member-solo": "MEM-EVT",
  "member-companion": "MEMC-EVT",
  "non-member-solo": "NM-EVT",
  "non-member-companion": "NMC-EVT",
};

const COURSE_TIER_REFERENCE_PREFIX: Record<string, string> = {
  "course-member-virtual": "CMV-CRS",
  "course-member-semipresencial": "CMS-CRS",
  "course-member-presencial": "CMP-CRS",
  "course-non-member": "CNM-CRS",
};

const COURSE_TIERS = new Set([
  "course-member-virtual",
  "course-member-semipresencial",
  "course-member-presencial",
  "course-non-member",
]);

const COMPANION_TIERS = new Set(["member-companion", "non-member-companion"]);

const ARPHA_TIERS = new Set([
  "arpha-tecnica",
  "arpha-emergencia",
  "arpha-juridica",
  "arpha-ruta",
]);

const SHOP_TIERS = new Set(["shop"]);

const ARPHA_TIER_PREFIX: Record<string, string> = {
  "arpha-tecnica": "ARPHA-TEC",
  "arpha-emergencia": "ARPHA-EMG",
  "arpha-juridica": "ARPHA-JUR",
  "arpha-ruta": "ARPHA-RUT",
};

const ARPHA_TIER_LABEL: Record<string, string> = {
  "arpha-tecnica": "Asistencia Técnica",
  "arpha-emergencia": "Emergencia",
  "arpha-juridica": "Asistencia Jurídica",
  "arpha-ruta": "Asistencia en Ruta",
};

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectModel(Transaction.name)
    private readonly transactionModel: Model<TransactionDocument>,
    private readonly configService: ConfigService<EnvironmentConfig>,
    private readonly eventsService: EventsService,
    private readonly shopService: ShopService,
    private readonly arphaService: ArphaService,
    private readonly usersService: UsersService,
  ) {}

  private static readonly TERMINAL_STATUSES = new Set([
    "APPROVED",
    "REJECTED",
    "FAILED",
    "VOIDED",
  ]);

  private static readonly MEMBER_TIERS = new Set([
    "member-solo",
    "member-companion",
    "course-member-virtual",
    "course-member-semipresencial",
    "course-member-presencial",
  ]);

  private async verifyActiveMember(userId: string): Promise<void> {
    const user = await this.usersService.findById(userId);
    if (!user) throw new NotFoundException("Usuario no encontrado");
    const now = new Date();
    const membershipExpired =
      user.membershipExpiryDate != null &&
      new Date(user.membershipExpiryDate) < now;
    const isActiveMember =
      (user.role as UserRole) === UserRole.MEMBER &&
      !membershipExpired &&
      !!user.membershipLevel;
    if (!isActiveMember) {
      throw new ForbiddenException(
        "No tienes una membresía activa para usar este tier de precio",
      );
    }
  }

  private generateBoldIntegritySignature(
    orderId: string,
    amount: number,
    currency: string,
  ): string {
    const secretKey = this.configService.get<string>("BOLD_SECRET_KEY", {
      infer: true,
    });
    if (!secretKey) {
      throw new BadRequestException("BOLD_SECRET_KEY not configured");
    }
    const concatenated = `${orderId}${amount}${currency}${secretKey}`;
    return crypto.createHash("sha256").update(concatenated).digest("hex");
  }

  async createPayment(userId: string, dto: CreatePaymentDto) {
    if (ARPHA_TIERS.has(dto.tier)) {
      return this.createArphaPayment(userId, dto);
    }

    if (COURSE_TIERS.has(dto.tier)) {
      return this.createCoursePayment(userId, dto);
    }

    if (SHOP_TIERS.has(dto.tier)) {
      return this.createShopPayment(userId, dto);
    }

    if (dto.productSlug || dto.relatedReference) {
      return this.createShopPayment(userId, dto);
    }

    return this.createEventPayment(userId, dto);
  }

  private async createArphaPayment(userId: string, dto: CreatePaymentDto) {
    const requestId = dto.eventSlug;
    const amount = ARPHA_PRICING[dto.tier.replace("arpha-", "")] ?? 15000;
    const label = ARPHA_TIER_LABEL[dto.tier] ?? "Asistencia ARPHA";

    const timestamp = Date.now();
    const shortUserId = userId.slice(-8);
    const reference = `${ARPHA_TIER_PREFIX[dto.tier]}-${shortUserId}-${timestamp}-${crypto.randomBytes(4).toString("hex")}`;

    const transaction = new this.transactionModel({
      userId,
      eventSlug: requestId,
      reference,
      amount,
      description: `ARPHA - ${label}`,
      status: "PENDING",
      tier: dto.tier,
      hasCompanion: false,
      purpose: "arpha",
      relatedReference: requestId,
    });

    await transaction.save();

    return this.buildBoldResponse(transaction, `ARPHA - ${label}`);
  }

  private async createEventPayment(userId: string, dto: CreatePaymentDto) {
    if (PaymentsService.MEMBER_TIERS.has(dto.tier)) {
      await this.verifyActiveMember(userId);
    }

    const event = await this.eventsService.getEventBySlug(dto.eventSlug);
    if (!event) {
      throw new NotFoundException("Evento no encontrado");
    }

    // M-21: Fail-closed pricing — when a non-member-tier (or member-tier
    // with companion) requires a non-zero price we must reject the
    // payment intent instead of silently accepting a $0 charge. The
    // previous `?? 0` default enabled a misconfigured event (missing
    // `nonMemberPrice`) to grant free entry to non-members.
    const isNonMemberTier = !PaymentsService.MEMBER_TIERS.has(dto.tier);
    const requiresPrice = isNonMemberTier || dto.tier === "member-companion";
    const basePrice = event.nonMemberPrice ?? null;
    if (requiresPrice && (basePrice === null || basePrice <= 0)) {
      throw new BadRequestException(
        "El evento no tiene un precio configurado. Contacta al administrador.",
      );
    }
    const safeBasePrice = basePrice ?? 0;
    const companionPrice =
      event.companionPrice ?? Math.round(safeBasePrice * 0.5);

    let amount: number;
    let description: string;

    switch (dto.tier) {
      case "member-solo":
        // A-4: When the event explicitly opts members out of free entry
        // (membersFree=false), the member pays the full non-member price.
        amount = event.membersFree ? 0 : safeBasePrice;
        description = `Inscripción ${event.title} - Miembro (Solo)${event.membersFree ? "" : " (Evento pago)"}`;
        break;
      case "member-companion":
        // A-4: For non-free events, the member also pays the solo fare
        // plus the companion fee.
        amount = event.membersFree
          ? companionPrice
          : safeBasePrice + companionPrice;
        description = `Inscripción ${event.title} - Miembro (Con acompañante)`;
        break;
      case "non-member-solo":
        amount = safeBasePrice;
        description = `Inscripción ${event.title} - No Miembro (Solo)`;
        break;
      case "non-member-companion":
        amount = safeBasePrice + companionPrice;
        description = `Inscripción ${event.title} - No Miembro (Con acompañante)`;
        break;
      default:
        throw new BadRequestException("Tier de pago inválido para evento");
    }

    const hasCompanion = COMPANION_TIERS.has(dto.tier);
    const timestamp = Date.now();
    const shortUserId = userId.slice(-8);
    const reference = `${EVENT_TIER_REFERENCE_PREFIX[dto.tier]}-${shortUserId}-${timestamp}-${crypto.randomBytes(4).toString("hex")}`;

    const transaction = new this.transactionModel({
      userId,
      eventSlug: dto.eventSlug,
      reference,
      amount,
      description,
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
      // PAY-15: Link free ($0) registrations to the benefit
      await this.linkPaymentByPurpose(transaction);
      return {
        reference,
        amount,
        status: "APPROVED",
        requiresPayment: false,
      };
    }

    return this.buildBoldResponse(transaction, description);
  }

  private async createCoursePayment(userId: string, dto: CreatePaymentDto) {
    if (PaymentsService.MEMBER_TIERS.has(dto.tier)) {
      await this.verifyActiveMember(userId);
    }

    const course = await this.eventsService.getCourseBySlug(dto.eventSlug);
    if (!course) {
      throw new NotFoundException("Curso no encontrado");
    }

    // M-21: Fail-closed pricing — only the member-virtual tier (which is
    // explicitly free) tolerates an unconfigured `nonMemberPrice`. Any
    // other tier requires a positive price on the course document.
    const basePrice = course.nonMemberPrice ?? null;
    if (dto.tier !== "course-member-virtual") {
      if (basePrice === null || basePrice <= 0) {
        throw new BadRequestException(
          "El curso no tiene un precio configurado. Contacta al administrador.",
        );
      }
    }
    const safeBasePrice = basePrice ?? 0;

    let amount: number;
    let description: string;

    switch (dto.tier) {
      case "course-member-virtual":
        amount = 0;
        description = `Inscripción ${course.title} - Miembro (Virtual)`;
        break;
      case "course-member-semipresencial":
        amount = Math.round(
          safeBasePrice * ((course.memberSemipresencialDiscount ?? 25) / 100),
        );
        description = `Inscripción ${course.title} - Miembro (Semipresencial)`;
        break;
      case "course-member-presencial":
        amount = Math.round(
          safeBasePrice * ((course.memberPresencialDiscount ?? 50) / 100),
        );
        description = `Inscripción ${course.title} - Miembro (Presencial)`;
        break;
      case "course-non-member":
        amount = safeBasePrice;
        description = `Inscripción ${course.title} - No Miembro`;
        break;
      default:
        throw new BadRequestException("Tier de pago inválido para curso");
    }

    const timestamp = Date.now();
    const shortUserId = userId.slice(-8);
    const reference = `${COURSE_TIER_REFERENCE_PREFIX[dto.tier]}-${shortUserId}-${timestamp}-${crypto.randomBytes(4).toString("hex")}`;

    const transaction = new this.transactionModel({
      userId,
      eventSlug: dto.eventSlug,
      reference,
      amount,
      description,
      status: "PENDING",
      tier: dto.tier,
      hasCompanion: false,
      purpose: "course",
      relatedReference: null,
    });

    await transaction.save();

    if (amount === 0) {
      transaction.status = "APPROVED";
      await transaction.save();
      this.logger.log(
        `Free course payment auto-approved: ${reference} for user ${userId}`,
      );
      // PAY-15: Link free ($0) course registration to the benefit
      await this.linkPaymentByPurpose(transaction);
      return {
        reference,
        amount,
        status: "APPROVED",
        requiresPayment: false,
      };
    }

    return this.buildBoldResponse(transaction, description);
  }

  private buildBoldResponse(
    transaction: TransactionDocument,
    description: string,
  ) {
    this.logger.log(
      `Payment intent created: ref=${maskReference(transaction.reference)} user=${maskUserId(transaction.userId)} amount=${maskAmount(transaction.amount)} COP`,
    );

    return {
      reference: transaction.reference,
      amount: transaction.amount,
      status: "PENDING",
      requiresPayment: true,
      boldConfig: this.buildBoldConfigFor(
        transaction.reference,
        transaction.amount,
        description,
      ),
    };
  }

  private async createShopPayment(userId: string, dto: CreatePaymentDto) {
    const orderNumber = dto.relatedReference ?? dto.productSlug;
    if (!orderNumber) {
      throw new BadRequestException(
        "relatedReference (orderNumber) requerido para pagos de tienda",
      );
    }

    const order = await this.shopService.getOrderByOrderNumber(
      orderNumber,
      userId,
      true,
    );
    if (!order) {
      throw new NotFoundException(
        "Orden no encontrada, no te pertenece, o ya fue pagada",
      );
    }

    const amount = order.total;
    if (Number.isNaN(amount) || amount < 0) {
      throw new BadRequestException("Monto de pago inválido");
    }

    const timestamp = Date.now();
    const shortUserId = userId.slice(-8);
    const reference = `SHOP-${shortUserId}-${timestamp}-${crypto.randomBytes(4).toString("hex")}`;

    const transaction = new this.transactionModel({
      userId,
      eventSlug: orderNumber,
      reference,
      amount,
      description: `Compra Tienda BSK - ${orderNumber}`,
      status: "PENDING",
      tier: dto.tier,
      hasCompanion: false,
      purpose: "shop",
      relatedReference: orderNumber,
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

    return this.buildBoldResponse(
      transaction,
      `Compra Tienda BSK - ${orderNumber}`,
    );
  }

  async handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
    this.verifyBoldWebhookSignature(rawBody, signature);

    const event = JSON.parse(rawBody.toString("utf-8")) as Record<
      string,
      unknown
    >;
    const parsed = this.parseBoldWebhookEvent(event);

    const transaction = await this.findWebhookTransaction(parsed);
    if (!transaction) return;

    this.recordWebhookEvent(transaction, event, parsed);

    const statusFromEvent = this.mapBoldStatus(parsed.eventType);
    if (this.isAmountMismatch(transaction, parsed, statusFromEvent)) {
      await transaction.save();
      return;
    }

    const didChange = this.applyWebhookStatusUpdate(
      transaction,
      parsed,
      statusFromEvent,
    );
    await transaction.save();
    this.logger.log(
      `Webhook processed: ${parsed.eventType} for reference: ${parsed.referenceId}`,
    );

    if (didChange && statusFromEvent === "APPROVED") {
      // C-2: idempotent benefit link — claim atomically before invoking
      // the side-effect so a duplicate webhook cannot double-link.
      if (!transaction.benefitGranted) {
        const claim = await this.transactionModel.updateOne(
          { _id: transaction._id, benefitGranted: false },
          { $set: { benefitGranted: true } },
        );
        if (claim.modifiedCount === 0) {
          return;
        }
        transaction.benefitGranted = true;
      }
      await this.linkPaymentByPurpose(transaction);
    }
  }

  /**
   * Locate the transaction referenced by a webhook, logging and returning
   * `null` when the payload is missing a reference, the reference is unknown,
   * or the webhook has already been processed (duplicate).
   */
  private async findWebhookTransaction(
    parsed: ReturnType<PaymentsService["parseBoldWebhookEvent"]>,
  ): Promise<TransactionDocument | null> {
    if (!parsed.referenceId) {
      this.logger.warn("Webhook received without reference");
      return null;
    }

    // Atomic find + dedup check to prevent race condition
    const transaction = await this.transactionModel.findOne({
      reference: parsed.referenceId,
    });
    if (!transaction) {
      this.logger.warn(
        `Webhook received for unknown reference: ${parsed.referenceId}`,
      );
      return null;
    }

    if (this.isDuplicateWebhook(transaction, parsed.notificationId)) {
      this.logger.log(
        `Duplicate webhook ignored: ${parsed.notificationId ?? parsed.paymentId}, ${parsed.referenceId}`,
      );
      return null;
    }

    // PAY-16: If notificationId is missing, use paymentId as fallback dedup
    if (parsed.notificationId === undefined && parsed.paymentId) {
      const seenByPaymentId = transaction.webhookEvents.some(
        (e) =>
          typeof e["paymentId"] === "string" &&
          e["paymentId"] === parsed.paymentId,
      );
      if (seenByPaymentId) {
        this.logger.log(
          `Duplicate webhook (by paymentId) ignored: ${parsed.paymentId}, ${parsed.referenceId}`,
        );
        return null;
      }
    }

    return transaction;
  }

  /**
   * A-13: Detect a mismatch between the amount reported by the webhook and
   * the amount stored on the transaction. Returns `true` (and logs a warning)
   * when an APPROVED webhook reports a different non-zero amount, so the
   * caller can skip approval and persist the recorded webhook event.
   */
  private isAmountMismatch(
    transaction: TransactionDocument,
    parsed: ReturnType<PaymentsService["parseBoldWebhookEvent"]>,
    statusFromEvent: string | null,
  ): boolean {
    if (statusFromEvent !== "APPROVED") return false;
    if (parsed.amount === undefined) return false;
    if (transaction.amount <= 0) return false;
    if (parsed.amount === transaction.amount) return false;

    this.logger.warn(
      `Amount mismatch in webhook for reference ${parsed.referenceId}: expected ${transaction.amount}, received ${parsed.amount}. Skipping approval.`,
    );
    return true;
  }

  /**
   * Apply the mapped webhook status to the transaction, persisting the
   * payment method and payer email when the status is APPROVED, or logging
   * a diagnostic message when the event type is not handled.
   */
  private applyWebhookStatusUpdate(
    transaction: TransactionDocument,
    parsed: ReturnType<PaymentsService["parseBoldWebhookEvent"]>,
    statusFromEvent: string | null,
  ): boolean {
    if (!statusFromEvent) {
      this.logger.log(
        `Unhandled webhook event type: ${parsed.eventType} for reference: ${parsed.referenceId}`,
      );
      return false;
    }

    // C-2: Block ALL transitions from a terminal status. Previously this
    // blocked only *different* terminal-status transitions, which
    // allowed a second APPROVED event ( SALE_APPROVED and
    // PAYMENT_APPROVED — same mapped status, different notificationId)
    // to slip past the guard and re-run linkPaymentByPurpose().
    if (PaymentsService.TERMINAL_STATUSES.has(transaction.status)) {
      this.logger.warn(
        `Ignoring ${statusFromEvent} for already-${transaction.status} transaction ${parsed.referenceId}`,
      );
      return false;
    }

    transaction.status = statusFromEvent;
    if (statusFromEvent !== "APPROVED") return true;

    if (parsed.paymentMethod) transaction.paymentMethod = parsed.paymentMethod;
    if (parsed.payerEmail) transaction.payerEmail = parsed.payerEmail;
    return true;
  }

  /** Verify the Bold webhook HMAC signature (throwing on mismatch). */
  private verifyBoldWebhookSignature(rawBody: Buffer, signature: string): void {
    const secretKey = this.configService.get<string>("BOLD_SECRET_KEY", {
      infer: true,
    });
    if (!secretKey) {
      this.logger.error("BOLD_SECRET_KEY not configured — rejecting webhook");
      throw new BadRequestException("Webhook secret key not configured");
    }
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
  }

  /** Parse the relevant fields from a Bold webhook event payload. */
  private parseBoldWebhookEvent(event: Record<string, unknown>): {
    notificationId: string | undefined;
    eventType: string | undefined;
    paymentId: string | undefined;
    referenceId: string | undefined;
    paymentMethod: string | undefined;
    payerEmail: string | undefined;
    amount: number | undefined;
  } {
    const notificationId = event["id"] as string | undefined;
    const eventType = event["type"] as string | undefined;
    const data = (event["data"] ?? {}) as Record<string, unknown>;
    const metadata = (data["metadata"] ?? {}) as Record<string, unknown>;
    return {
      notificationId,
      eventType,
      paymentId: data["payment_id"] as string | undefined,
      referenceId: metadata["reference"] as string | undefined,
      paymentMethod: data["payment_method"] as string | undefined,
      payerEmail: data["payer_email"] as string | undefined,
      amount: this.parseBoldAmount(data["amount"]),
    };
  }

  private parseBoldAmount(raw: unknown): number | undefined {
    if (typeof raw === "number") return raw;
    if (raw && typeof raw === "object") {
      const obj = raw as Record<string, unknown>;
      const total = obj["total"];
      if (typeof total === "number") return total;
      const amount = obj["amount"];
      if (typeof amount === "number") return amount;
    }
    return undefined;
  }

  /** Returns true when the same Bold webhook has already been processed. */
  private isDuplicateWebhook(
    transaction: TransactionDocument,
    notificationId: string | undefined,
  ): boolean {
    if (notificationId === undefined) return false;
    return transaction.webhookEvents.some(
      (e) =>
        typeof e["notificationId"] === "string" &&
        e["notificationId"] === notificationId,
    );
  }

  /** Persist a webhook event slot onto the transaction. */
  private recordWebhookEvent(
    transaction: TransactionDocument,
    event: Record<string, unknown>,
    parsed: ReturnType<PaymentsService["parseBoldWebhookEvent"]>,
  ): void {
    const webhookEvent = new WebhookEvent();
    webhookEvent.notificationId = parsed.notificationId ?? "UNKNOWN";
    webhookEvent.paymentId = parsed.paymentId ?? "UNKNOWN";
    webhookEvent.type = parsed.eventType ?? "UNKNOWN";
    webhookEvent.receivedAt = new Date();
    webhookEvent.data = event;
    transaction.webhookEvents.push(webhookEvent);
    if (parsed.paymentId && !transaction.boldPaymentId) {
      transaction.boldPaymentId = parsed.paymentId;
    }
  }

  private async linkPaymentByPurpose(
    transaction: TransactionDocument,
  ): Promise<void> {
    try {
      if (transaction.purpose === "shop" && transaction.relatedReference) {
        await this.shopService.linkOrderPayment(
          transaction.relatedReference,
          transaction.reference,
        );
        this.logger.log(
          `Shop order payment linked: order=${transaction.relatedReference} ref=${transaction.reference}`,
        );
      } else if (transaction.purpose === "arpha") {
        await this.arphaService.linkArphaPayment(
          transaction.userId,
          transaction.eventSlug,
          transaction.reference,
        );
        this.logger.log(
          `ARPHA payment linked: user=${transaction.userId} request=${transaction.eventSlug}`,
        );
      } else if (transaction.purpose === "course") {
        await this.eventsService.linkCoursePayment(
          transaction.userId,
          transaction.eventSlug,
          transaction.reference,
        );
        this.logger.log(
          `Course payment linked: user=${transaction.userId} course=${transaction.eventSlug}`,
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

  private async syncWithBold(transaction: TransactionDocument): Promise<void> {
    if (this.isBoldSyncRateLimited(transaction)) {
      return;
    }

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

    const boldEnv =
      this.configService.get<string>("BOLD_ENVIRONMENT", {
        infer: true,
      }) ?? "sandbox";
    const baseUrl =
      boldEnv === "production"
        ? "https://payments.api.bold.co"
        : "https://payments-api-test.bold.co";
    const url = `${baseUrl}/v2/payment-voucher/${encodeURIComponent(transaction.reference)}`;

    transaction.lastBoldSyncAt = new Date();
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
      await this.applyBoldVoucherBody(transaction, body);
    } catch (err: unknown) {
      this.logger.warn(
        `Bold sync failed for ${transaction.reference}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Returns true when the last Bold sync was too recent (rate limit). */
  private isBoldSyncRateLimited(transaction: TransactionDocument): boolean {
    const now = new Date();
    const minIntervalMs = 10_000;
    return (
      !!transaction.lastBoldSyncAt &&
      now.getTime() - new Date(transaction.lastBoldSyncAt).getTime() <
        minIntervalMs
    );
  }

  /** Map a Bold voucher body to a transaction status update + linking. */
  private async applyBoldVoucherBody(
    transaction: TransactionDocument,
    body: Record<string, unknown>,
  ): Promise<void> {
    const boldStatus = body["payment_status"] as string | undefined;

    if (!boldStatus || boldStatus === "NO_TRANSACTION_FOUND") {
      this.logger.log(
        `Bold sync: no transaction found yet for reference: ${transaction.reference}`,
      );
      return;
    }

    const mappedStatus = this.mapBoldVoucherStatus(boldStatus);
    if (!mappedStatus) {
      return;
    }

    // C-2/A-1: Block ALL transitions from a terminal status — sync must
    // never override a terminal webhook outcome.
    if (PaymentsService.TERMINAL_STATUSES.has(transaction.status)) {
      this.logger.warn(
        `Bold sync: ignoring ${mappedStatus} for already-${transaction.status} reference ${transaction.reference}`,
      );
      return;
    }

    // A-9: Validate the voucher amount against the transaction amount
    // before approving (mirrors the webhook path). Previously the sync
    // route approved on `payment_status` alone.
    if (mappedStatus === "APPROVED") {
      const voucherAmount = this.parseBoldAmount(body["amount"]);
      if (
        voucherAmount !== undefined &&
        transaction.amount > 0 &&
        voucherAmount !== transaction.amount
      ) {
        this.logger.warn(
          `Amount mismatch in Bold voucher sync for ref ${transaction.reference}: expected ${transaction.amount}, received ${voucherAmount}. Skipping approval.`,
        );
        return;
      }
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
      // C-2: idempotent benefit link for sync path.
      if (!transaction.benefitGranted) {
        const claim = await this.transactionModel.updateOne(
          { _id: transaction._id, benefitGranted: false },
          { $set: { benefitGranted: true } },
        );
        if (claim.modifiedCount === 0) {
          return;
        }
        transaction.benefitGranted = true;
      }
      await this.linkPaymentByPurpose(transaction);
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
      purpose: string;
      boldPaymentId: string | null;
      paymentMethod: string | null;
      createdAt: Date;
      updatedAt: Date;
      requiresPayment: boolean;
      boldConfig?: {
        publicKey: string;
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
      purpose: transaction.purpose,
      boldPaymentId: transaction.boldPaymentId,
      paymentMethod: transaction.paymentMethod,
      createdAt: transaction.createdAt,
      updatedAt: transaction.updatedAt,
      requiresPayment: transaction.status === "PENDING",
    };

    if (transaction.status === "PENDING" && transaction.amount > 0) {
      result.boldConfig = this.buildBoldConfigFor(
        transaction.reference,
        transaction.amount,
        transaction.description,
      );
    }

    return result;
  }

  /** Build the Bold public config block returned to the frontend widget. */
  private buildBoldConfigFor(
    reference: string,
    amount: number,
    description: string,
  ): {
    publicKey: string;
    environment: string;
    baseUrl: string;
    referenceId: string;
    description: string;
    amount: number;
    currency: string;
    integritySignature: string;
  } {
    const boldEnvironment =
      this.configService.get<string>("BOLD_ENVIRONMENT", {
        infer: true,
      }) ?? "sandbox";
    const boldPublicKey =
      this.configService.get<string>("BOLD_PUBLIC_KEY", {
        infer: true,
      }) ?? "";
    const boldBaseUrl =
      boldEnvironment === "production"
        ? "https://payments.api.bold.co"
        : "https://payments-api-test.bold.co";
    return {
      publicKey: boldPublicKey,
      environment: boldEnvironment,
      baseUrl: boldBaseUrl,
      referenceId: reference,
      description,
      amount,
      currency: "COP",
      integritySignature: this.generateBoldIntegritySignature(
        reference,
        amount,
        "COP",
      ),
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
      .select("-webhookEvents -__v -companionData");

    return transactions.map((t) => ({
      reference: t.reference,
      eventSlug: t.eventSlug,
      status: t.status,
      amount: t.amount,
      description: t.description,
      tier: t.tier,
      purpose: t.purpose,
      relatedReference: t.relatedReference,
      hasCompanion: t.hasCompanion,
      companionData: undefined,
      paymentMethod: t.paymentMethod,
      createdAt: t.createdAt,
    }));
  }
}
