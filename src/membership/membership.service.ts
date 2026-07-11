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
import * as crypto from "node:crypto";
import {
  MembershipTransaction,
  MembershipTransactionDocument,
} from "./schemas/membership-transaction.schema";
import {
  ServiceCreditTransaction,
  ServiceCreditTransactionDocument,
  CreditTransactionType,
  CreditSource,
} from "./schemas/service-credit-transaction.schema";
import { CreateMembershipPaymentDto } from "./dto/create-membership-payment.dto";
import { CreditChoiceDto } from "./dto/credit-choice.dto";
import { UseCreditDto } from "./dto/use-credit.dto";
import { UsersService } from "../users/users.service";
import { UserRole, CreditType } from "../users/schemas/user.schema";
import type { PartialPaymentCredit } from "../users/schemas/user.schema";
import { NotificationsService } from "../notifications/notifications.service";

/** Shared contextual shape used to keep helper signatures ≤ 7 parameters. */
interface MembershipPaymentContext {
  installmentNumber: number;
  installmentTotal: number;
  isRenewal: boolean;
}
import {
  NotificationType,
  NotificationPriority,
} from "../notifications/schemas/notification.schema";
import type { EnvironmentConfig } from "../config/config.interface";
import {
  maskAmount,
  maskReference,
  maskUserId,
} from "../common/utils/log-redact.util";
import {
  SINGLE_PAYMENT_AMOUNT,
  INSTALLMENT_AMOUNT,
  INSTALLMENTS_TOTAL,
  MEMBERSHIP_DURATION_MS,
  CREDIT_EXPIRY_MONTHS,
} from "./membership.constants";

@Injectable()
export class MembershipService {
  private readonly logger = new Logger(MembershipService.name);

  constructor(
    @InjectModel(MembershipTransaction.name)
    private readonly transactionModel: Model<MembershipTransactionDocument>,
    @InjectModel(ServiceCreditTransaction.name)
    private readonly creditTransactionModel: Model<ServiceCreditTransactionDocument>,
    private readonly usersService: UsersService,
    private readonly notificationsService: NotificationsService,
    private readonly configService: ConfigService<EnvironmentConfig>,
  ) {}

  /** Format a human-readable membership description across renewal/new plans. */
  private formatMembershipDescription(
    isRenewal: boolean,
    paymentPlan: string,
    installmentNumber: number,
    installmentTotal: number,
    paidWithCredit = false,
  ): string {
    const suffix = paidWithCredit ? " (pagada con crédito)" : "";
    if (isRenewal) {
      return `Renovación anticipada membresía BSK — Cuota ${installmentNumber}/${installmentTotal}${suffix}`;
    }
    if (paymentPlan === "single") {
      return `Membresía Legend BSK — Pago único anual${suffix}`;
    }
    return `Membresía Legend BSK — Cuota ${installmentNumber}/${installmentTotal}${suffix}`;
  }

  /** Format the description used in `getMembershipPayment` (renewal/single/installment four-way). */
  private formatStoredMembershipDescription(
    paymentPlan: string,
    isRenewal: boolean,
    installmentNumber: number,
    installmentTotal: number,
  ): string {
    if (paymentPlan === "single") {
      return isRenewal
        ? "Renovación Membresía Legend BSK — Pago único anual"
        : "Membresía Legend BSK — Pago único anual";
    }
    const prefix = isRenewal
      ? "Renovación Membresía Legend BSK"
      : "Membresía Legend BSK";
    return `${prefix} — Cuota ${installmentNumber}/${installmentTotal}`;
  }

  /** Build the Bold public configuration block returned to the frontend widget. */
  private buildBoldConfig(
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
    const boldPublicKey =
      this.configService.get<string>("BOLD_PUBLIC_KEY", {
        infer: true,
      }) ?? "";
    const boldEnvironment =
      this.configService.get<string>("BOLD_ENVIRONMENT", {
        infer: true,
      }) ?? "sandbox";
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

  /** Build a unique reference string for a membership transaction. */
  private buildMembershipReference(
    paymentPlan: string,
    isRenewal: boolean,
    installmentNumber: number,
    userId: string,
  ): string {
    const timestamp = Date.now();
    const shortUserId = userId.slice(-8);
    const planPrefix = paymentPlan === "single" ? "MEM" : "MEMI";
    const renewSuffix = isRenewal ? "R" : "";
    return `${planPrefix}${renewSuffix}-${shortUserId}-${installmentNumber}-${timestamp}`;
  }

  /** Validate renewal-only eligibility rules. Throws if the user cannot renew. */
  private validateRenewalEligibility(
    userRole: string,
    isInGracePeriod: boolean,
    membershipExpired: boolean,
  ): void {
    const memberRole = UserRole.MEMBER as string;
    if (userRole !== memberRole) {
      throw new BadRequestException(
        "Solo los miembros activos pueden renovar anticipadamente",
      );
    }
    if (membershipExpired) {
      throw new BadRequestException(
        isInGracePeriod
          ? "Tu membresía expiró pero estás en periodo de gracia. Compra una nueva membresía, no una renovación."
          : "Tu membresía ya expiró. Debe comprar una nueva membresía, no una renovación.",
      );
    }
  }

  /** Validate the eligibility of buying a brand-new membership. */
  private validateNewMembershipEligibility(
    userRole: string,
    membershipExpired: boolean,
  ): void {
    const memberRole = UserRole.MEMBER as string;
    if (userRole === memberRole && !membershipExpired) {
      throw new BadRequestException(
        "Ya tienes una membresía activa. Usa la opción de renovación anticipada.",
      );
    }
  }

  /** Compute the next installment number for an installment plan. */
  private async computeNextInstallmentNumber(
    userId: string,
    isRenewal: boolean,
  ): Promise<number> {
    const lastTx = await this.transactionModel
      .findOne({
        userId,
        paymentPlan: "installment",
        isRenewal,
        status: "APPROVED",
      })
      .sort({ installmentNumber: -1 });

    if (!lastTx) return 1;
    if (lastTx.installmentNumber >= INSTALLMENTS_TOTAL) {
      throw new ConflictException(
        "Ya completaste las 12 cuotas. Tu membresía debería estar activa.",
      );
    }
    return lastTx.installmentNumber + 1;
  }

  /** Returns true when the credit has expired (no expiry date means not expired). */
  private isCreditExpired(
    credit: { expiresAt: Date | null },
    now: Date,
  ): boolean {
    return credit.expiresAt ? new Date(credit.expiresAt) < now : false;
  }

  /** Apply credit toward the membership payment if requested. Mutates state. */
  private async applyCreditIfRequested(
    userId: string,
    dto: CreateMembershipPaymentDto,
    user: { partialPaymentCredit?: PartialPaymentCredit | null },
    totalAmount: number,
    ctx: MembershipPaymentContext,
    now: Date,
  ): Promise<{ creditUsedAmount: number; remainingAmount: number }> {
    const { installmentNumber, installmentTotal, isRenewal } = ctx;
    if (!dto.useCredit || !dto.creditAmount || dto.creditAmount <= 0) {
      return { creditUsedAmount: 0, remainingAmount: totalAmount };
    }
    const credit = user.partialPaymentCredit;
    if (credit?.type !== CreditType.MEMBERSHIP) {
      throw new BadRequestException(
        "No tienes crédito de membresía disponible",
      );
    }
    if (this.isCreditExpired(credit, now)) {
      throw new BadRequestException("Tu crédito ha expirado");
    }
    const availableCredit = credit.amount - credit.usedAmount;
    if (availableCredit <= 0) {
      throw new BadRequestException(
        "Tu crédito ya ha sido utilizado por completo",
      );
    }

    const creditUsedAmount = Math.min(
      dto.creditAmount,
      availableCredit,
      totalAmount,
    );
    const remainingAmount = totalAmount - creditUsedAmount;

    // A-3: Use atomic $inc with optimistic locking on expectedUsedAmount
    const updated =
      await this.usersService.incrementPartialPaymentCreditUsedAmount(
        userId,
        creditUsedAmount,
        credit.usedAmount,
      );
    if (!updated) {
      throw new ConflictException(
        "Conflicto al aplicar crédito: tu saldo fue modificado. Intenta de nuevo.",
      );
    }

    const timestamp = Date.now();
    const shortUserId = userId.slice(-8);
    const creditRef = `CRU-${shortUserId}-${timestamp}`;
    await this.creditTransactionModel.create({
      userId,
      reference: creditRef,
      transactionType: CreditTransactionType.CREDIT_USED,
      creditSource: CreditSource.MEMBERSHIP,
      amount: creditUsedAmount,
      description: `Crédito aplicado a ${isRenewal ? "renovación" : "nueva"} membresía — cuota ${installmentNumber}/${installmentTotal}`,
      metadata: {
        membershipPaymentPlan: dto.paymentPlan,
        installmentNumber,
        isRenewal,
      },
    });

    this.logger.log(
      `Credit applied to membership: user=${maskUserId(userId)} creditAmount=${maskAmount(creditUsedAmount)} remaining=${maskAmount(remainingAmount)}`,
    );

    return { creditUsedAmount, remainingAmount };
  }

  /** Build the pending-payment response object sent back to the frontend. */
  private buildPendingPaymentResponse(
    reference: string,
    totalAmount: number,
    remainingAmount: number,
    creditUsedAmount: number,
    ctx: MembershipPaymentContext,
    description: string,
  ) {
    const { installmentNumber, installmentTotal, isRenewal } = ctx;
    return {
      reference,
      amount: remainingAmount,
      totalAmount,
      creditUsed: creditUsedAmount,
      remainingAmount,
      status: "PENDING",
      installmentNumber,
      installmentTotal,
      isRenewal,
      paidWithCredit: creditUsedAmount > 0,
      description,
      boldConfig: this.buildBoldConfig(reference, remainingAmount, description),
    };
  }

  /** Send the "payment rejected" notification for a failed/rejected transaction. */
  private async sendRejectionNotification(
    transaction: MembershipTransactionDocument,
    mappedStatus: string,
  ): Promise<void> {
    const friendly =
      mappedStatus === "REJECTED"
        ? "Tu pago fue rechazado por la pasarela. Puedes intentarlo de nuevo."
        : "Ocurrió un fallo procesando tu pago. Revisa tu método de pago e intenta nuevamente.";
    const rejectedUser = await this.usersService.findById(transaction.userId);
    await this.notificationsService.create({
      userId: transaction.userId,
      type: NotificationType.MEMBERSHIP_PAYMENT_REJECTED,
      title: "Pago de membresía rechazado",
      message: `${friendly} Referencia: ${transaction.reference}.`,
      priority: NotificationPriority.HIGH,
      metadata: {
        paymentPlan: transaction.paymentPlan,
        installmentNumber: transaction.installmentNumber,
        installmentTotal: transaction.installmentTotal,
        status: mappedStatus,
      },
      relatedReference: transaction.reference,
      emailTo: rejectedUser?.email,
    });
  }

  private generateBoldIntegritySignature(
    orderId: string,
    amount: number,
    currency: string,
  ): string {
    const secretKey =
      this.configService.get<string>("BOLD_SECRET_KEY", {
        infer: true,
      }) ?? "";
    const concatenated = `${orderId}${amount}${currency}`;
    return crypto
      .createHmac("sha256", secretKey)
      .update(concatenated)
      .digest("hex");
  }

  async createMembershipPayment(
    userId: string,
    dto: CreateMembershipPaymentDto,
  ) {
    const user = await this.usersService.findById(userId);
    if (!user) throw new NotFoundException("Usuario no encontrado");

    const isRenewal = dto.isRenewal === true;
    const now = new Date();
    const membershipExpired =
      user.membershipExpiryDate != null &&
      new Date(user.membershipExpiryDate) < now;
    const isInGracePeriod =
      membershipExpired &&
      user.membershipGracePeriodEnd != null &&
      new Date(user.membershipGracePeriodEnd) > now;

    if (isRenewal) {
      this.validateRenewalEligibility(
        user.role,
        isInGracePeriod,
        membershipExpired,
      );
    } else {
      this.validateNewMembershipEligibility(user.role, membershipExpired);
    }

    const totalAmount =
      dto.paymentPlan === "single" ? SINGLE_PAYMENT_AMOUNT : INSTALLMENT_AMOUNT;
    const installmentTotal =
      dto.paymentPlan === "single" ? 1 : INSTALLMENTS_TOTAL;
    const installmentNumber =
      dto.paymentPlan === "installment"
        ? await this.computeNextInstallmentNumber(userId, isRenewal)
        : 1;

    const { creditUsedAmount, remainingAmount } =
      await this.applyCreditIfRequested(
        userId,
        dto,
        user,
        totalAmount,
        { installmentNumber, installmentTotal, isRenewal },
        now,
      );

    if (remainingAmount === 0 && creditUsedAmount > 0) {
      return this.handleFullyPaidWithCredit(
        userId,
        dto,
        totalAmount,
        { installmentNumber, installmentTotal, isRenewal },
        creditUsedAmount,
        now,
      );
    }

    const reference = this.buildMembershipReference(
      dto.paymentPlan,
      isRenewal,
      installmentNumber,
      userId,
    );
    const transaction = new this.transactionModel({
      userId,
      reference,
      paymentPlan: dto.paymentPlan,
      amount: remainingAmount,
      installmentNumber,
      installmentTotal,
      status: "PENDING",
      isRenewal,
    });
    await transaction.save();

    const description = this.formatMembershipDescription(
      isRenewal,
      dto.paymentPlan,
      installmentNumber,
      installmentTotal,
    );

    this.logger.log(
      `Membership payment intent: ref=${maskReference(reference)} user=${maskUserId(userId)} amount=${maskAmount(remainingAmount)} (total=${maskAmount(totalAmount)}, credit=${maskAmount(creditUsedAmount)}) plan=${dto.paymentPlan} installment=${installmentNumber}/${installmentTotal} renewal=${isRenewal}`,
    );

    return this.buildPendingPaymentResponse(
      reference,
      totalAmount,
      remainingAmount,
      creditUsedAmount,
      { installmentNumber, installmentTotal, isRenewal },
      description,
    );
  }

  /** Process the case where the full payment is covered by credit (no Bold flow needed). */
  private async handleFullyPaidWithCredit(
    userId: string,
    dto: CreateMembershipPaymentDto,
    totalAmount: number,
    ctx: MembershipPaymentContext,
    creditUsedAmount: number,
    now: Date,
  ) {
    const { installmentNumber, installmentTotal, isRenewal } = ctx;
    const reference = this.buildMembershipReference(
      dto.paymentPlan,
      isRenewal,
      installmentNumber,
      userId,
    );
    const transaction = new this.transactionModel({
      userId,
      reference,
      paymentPlan: dto.paymentPlan,
      amount: totalAmount,
      installmentNumber,
      installmentTotal,
      status: "APPROVED",
      isRenewal,
      paidAt: now,
      paymentMethod: "credit",
    });
    await transaction.save();
    await this.processApprovedPayment(transaction);
    this.logger.log(
      `Membership fully paid with credit: user=${maskUserId(userId)} ref=${maskReference(reference)}`,
    );
    return {
      reference,
      amount: totalAmount,
      creditUsed: creditUsedAmount,
      remainingAmount: 0,
      status: "APPROVED",
      installmentNumber,
      installmentTotal,
      isRenewal,
      paidWithCredit: true,
      description: this.formatMembershipDescription(
        isRenewal,
        dto.paymentPlan,
        installmentNumber,
        installmentTotal,
        true,
      ),
    };
  }

  async handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
    this.verifyBoldWebhookSignature(rawBody, signature);

    const event = JSON.parse(rawBody.toString("utf-8")) as Record<
      string,
      unknown
    >;
    const parsed = this.parseBoldWebhookEvent(event);
    if (!parsed.referenceId) {
      this.logger.warn("Membership webhook without reference");
      return;
    }

    const transaction = await this.transactionModel.findOne({
      reference: parsed.referenceId,
    });
    if (!transaction) {
      this.logger.warn(
        `Membership webhook for unknown reference: ${maskReference(parsed.referenceId ?? "")}`,
      );
      return;
    }

    if (this.isDuplicateWebhook(transaction, parsed.notificationId)) {
      this.logger.log(
        `Duplicate membership webhook ignored: ${parsed.notificationId ?? parsed.paymentId}, ${parsed.referenceId}`,
      );
      return;
    }

    this.recordWebhookEvent(transaction, event, parsed);

    const statusFromEvent = this.mapBoldStatus(parsed.eventType);
    // A-13: Validate webhook amount against transaction amount before approval
    if (
      statusFromEvent === "APPROVED" &&
      parsed.amount !== undefined &&
      transaction.amount > 0 &&
      parsed.amount !== transaction.amount
    ) {
      this.logger.warn(
        `Amount mismatch in membership webhook for ref ${maskReference(parsed.referenceId ?? "")}: expected ${transaction.amount}, received ${parsed.amount}. Skipping approval.`,
      );
      await transaction.save();
      return;
    }
    if (statusFromEvent) {
      this.applyWebhookStatusUpdate(transaction, statusFromEvent, parsed);
    }

    await transaction.save();
    this.logger.log(
      `Membership webhook processed: ${parsed.eventType} for ${maskReference(parsed.referenceId ?? "")}`,
    );

    if (statusFromEvent === "APPROVED") {
      await this.processApprovedPayment(transaction);
    } else if (statusFromEvent === "REJECTED" || statusFromEvent === "FAILED") {
      await this.sendRejectionNotification(transaction, statusFromEvent);
    }
  }

  /** Verify the Bold webhook HMAC signature (throwing on mismatch). */
  private verifyBoldWebhookSignature(rawBody: Buffer, signature: string): void {
    const secretKey =
      this.configService.get<string>("BOLD_SECRET_KEY", { infer: true }) ?? "";
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
      this.logger.warn("Invalid membership webhook signature");
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
      amount: typeof data["amount"] === "number" ? data["amount"] : undefined,
    };
  }

  /** Returns true when the same Bold webhook has already been processed. */
  private isDuplicateWebhook(
    transaction: MembershipTransactionDocument,
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
    transaction: MembershipTransactionDocument,
    event: Record<string, unknown>,
    parsed: ReturnType<MembershipService["parseBoldWebhookEvent"]>,
  ): void {
    transaction.webhookEvents.push({
      notificationId: parsed.notificationId ?? "UNKNOWN",
      paymentId: parsed.paymentId ?? "UNKNOWN",
      type: parsed.eventType ?? "UNKNOWN",
      receivedAt: new Date(),
      data: event,
    });
    if (parsed.paymentId && !transaction.boldPaymentId) {
      transaction.boldPaymentId = parsed.paymentId;
    }
  }

  /** Mutate the transaction based on the mapped Bold status. */
  private applyWebhookStatusUpdate(
    transaction: MembershipTransactionDocument,
    status: string,
    parsed: ReturnType<MembershipService["parseBoldWebhookEvent"]>,
  ): void {
    if (status === "APPROVED") {
      transaction.status = "APPROVED";
      transaction.paidAt = new Date();
      if (parsed.paymentMethod)
        transaction.paymentMethod = parsed.paymentMethod;
      if (parsed.payerEmail) transaction.payerEmail = parsed.payerEmail;
    } else {
      transaction.status = status;
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
      default:
        return null;
    }
  }

  private async processApprovedPayment(
    transaction: MembershipTransactionDocument,
  ) {
    const user = await this.usersService.findById(transaction.userId);
    if (!user) {
      this.logger.warn(
        `User not found for approved membership payment: ${transaction.userId}`,
      );
      return;
    }

    if (transaction.isRenewal) {
      await this.processRenewalApproval(transaction, user);
      return;
    }

    if (transaction.paymentPlan === "single") {
      await this.processSingleNewPaymentActivation(transaction, user);
      return;
    }

    await this.processInstallmentApproval(transaction, user);
  }

  /** Process the renewal branch of an approved membership payment. */
  private async processRenewalApproval(
    transaction: MembershipTransactionDocument,
    user: {
      email: string;
      membershipExpiryDate?: Date | null;
      renewalInstallmentsPaid?: number | null;
    },
  ): Promise<void> {
    const newRenewalCount = (user.renewalInstallmentsPaid ?? 0) + 1;
    await this.usersService.updateMembershipRenewal(
      transaction.userId,
      newRenewalCount,
    );

    const isComplete =
      transaction.paymentPlan === "single" ||
      newRenewalCount >= INSTALLMENTS_TOTAL;

    if (!isComplete) {
      await this.notificationsService.create({
        userId: transaction.userId,
        type: NotificationType.MEMBERSHIP_INSTALLMENT_PAID,
        title: `Cuota de renovación ${newRenewalCount}/${INSTALLMENTS_TOTAL} pagada`,
        message: `Hemos registrado tu pago. Te faltan ${INSTALLMENTS_TOTAL - newRenewalCount} cuotas para completar tu renovación.`,
        priority: NotificationPriority.MEDIUM,
        metadata: {
          installmentNumber: newRenewalCount,
          installmentTotal: INSTALLMENTS_TOTAL,
          isRenewal: true,
        },
        emailTo: user.email,
        relatedReference: transaction.reference,
      });
      return;
    }

    await this.activateRenewalMembership(transaction, user, newRenewalCount);
  }

  /** Calculate the renewal expiry date and activate membership + notification. */
  private async activateRenewalMembership(
    transaction: MembershipTransactionDocument,
    user: { email: string; membershipExpiryDate?: Date | null },
    newRenewalCount: number,
  ): Promise<void> {
    const now = new Date();
    const currentExpiry = user.membershipExpiryDate
      ? new Date(user.membershipExpiryDate)
      : now;
    const baseDate = currentExpiry > now ? currentExpiry : now;
    const newExpiry = new Date(baseDate.getTime() + MEMBERSHIP_DURATION_MS);

    await this.usersService.activateMembership(
      transaction.userId,
      baseDate,
      newExpiry,
      transaction.paymentPlan === "single" ? "single" : "installments",
    );

    this.logger.log(
      `Membership renewed: user=${maskUserId(transaction.userId)} expiry=${newExpiry.toISOString()}`,
    );

    await this.notificationsService.create({
      userId: transaction.userId,
      type: NotificationType.MEMBERSHIP_ACTIVATED,
      title: "Membresía renovada",
      message: this.formatRenewalActivationMessage(
        transaction.paymentPlan,
        newExpiry,
      ),
      priority: NotificationPriority.HIGH,
      metadata: {
        paymentPlan: transaction.paymentPlan,
        renewalInstallmentsPaid: newRenewalCount,
        newExpiry: newExpiry.toISOString(),
      },
      relatedReference: transaction.reference,
      emailTo: user.email,
    });
  }

  /** Format the activation message for a renewed membership (single vs 12-installments). */
  private formatRenewalActivationMessage(
    paymentPlan: string,
    newExpiry: Date,
  ): string {
    return paymentPlan === "single"
      ? `Tu renovación anual fue confirmada. Tu membresía Legend está activa hasta el ${newExpiry.toLocaleDateString("es-CO")}.`
      : `Completaste las 12 cuotas de renovación. Tu membresía Legend está activa hasta el ${newExpiry.toLocaleDateString("es-CO")}.`;
  }

  /** Activate a brand-new single-payment membership and notify. */
  private async processSingleNewPaymentActivation(
    transaction: MembershipTransactionDocument,
    user: { email: string },
  ): Promise<void> {
    const now = new Date();
    const expiry = new Date(now.getTime() + MEMBERSHIP_DURATION_MS);
    await this.usersService.activateMembership(
      transaction.userId,
      now,
      expiry,
      "single",
    );
    this.logger.log(
      `Membership activated (single payment): user=${maskUserId(transaction.userId)} expiry=${expiry.toISOString()}`,
    );

    await this.notificationsService.create({
      userId: transaction.userId,
      type: NotificationType.MEMBERSHIP_ACTIVATED,
      title: "Membresía Legend activada",
      message: `Tu pago único fue confirmado. Tu membresía Legend está activa hasta el ${expiry.toLocaleDateString("es-CO")}. ¡Bienvenido al ecosistema BSK!`,
      priority: NotificationPriority.HIGH,
      metadata: {
        paymentPlan: "single",
        amount: transaction.amount,
        newExpiry: expiry.toISOString(),
      },
      relatedReference: transaction.reference,
      emailTo: user.email,
    });
  }

  /** Handle an approved installment for a brand-new membership. */
  private async processInstallmentApproval(
    transaction: MembershipTransactionDocument,
    user: { email: string },
  ): Promise<void> {
    const approvedCount = await this.usersService.incrementInstallmentsPaid(
      transaction.userId,
    );

    if (approvedCount >= INSTALLMENTS_TOTAL) {
      await this.activateCompleteInstallmentsMembership(
        transaction,
        user,
        approvedCount,
      );
    } else {
      this.logger.log(
        `Installment ${approvedCount}/${INSTALLMENTS_TOTAL} paid: user=${maskUserId(transaction.userId)}`,
      );
      await this.notificationsService.create({
        userId: transaction.userId,
        type: NotificationType.MEMBERSHIP_INSTALLMENT_PAID,
        title: `Cuota ${approvedCount}/${INSTALLMENTS_TOTAL} pagada`,
        message: `Hemos registrado tu pago de la cuota ${approvedCount} de ${INSTALLMENTS_TOTAL}. Te faltan ${INSTALLMENTS_TOTAL - approvedCount} cuotas para activar tu membresía Legend.`,
        priority: NotificationPriority.MEDIUM,
        metadata: {
          installmentNumber: approvedCount,
          installmentTotal: INSTALLMENTS_TOTAL,
          amount: transaction.amount,
        },
        relatedReference: transaction.reference,
        emailTo: user.email,
      });
    }
  }

  /** Activate the membership once the 12th installment has been paid. */
  private async activateCompleteInstallmentsMembership(
    transaction: MembershipTransactionDocument,
    user: { email: string },
    approvedCount: number,
  ): Promise<void> {
    const now = new Date();
    const expiry = new Date(now.getTime() + MEMBERSHIP_DURATION_MS);
    await this.usersService.activateMembership(
      transaction.userId,
      now,
      expiry,
      "installments",
    );
    this.logger.log(
      `Membership activated (12 installments complete): user=${maskUserId(transaction.userId)} expiry=${expiry.toISOString()}`,
    );

    await this.notificationsService.create({
      userId: transaction.userId,
      type: NotificationType.MEMBERSHIP_ACTIVATED,
      title: "Membresía Legend activada",
      message: `Completaste las 12 cuotas. Tu membresía Legend está activa hasta el ${expiry.toLocaleDateString("es-CO")}. ¡Bienvenido al ecosistema BSK!`,
      priority: NotificationPriority.HIGH,
      metadata: {
        paymentPlan: "installment",
        installmentsPaid: approvedCount,
        newExpiry: expiry.toISOString(),
      },
      relatedReference: transaction.reference,
      emailTo: user.email,
    });
  }

  /**
   * Queries Bold's payment-voucher API for the real-time status of a
   * transaction. This is the recommended fallback when the webhook is not
   * received (Docs_Bold/pagos_en_linea/consulta_de_transacciones.md).
   *
   * Rate-limited via `lastBoldSyncAt` to at most one call every 10 seconds,
   * preventing excessive API requests during frontend polling.
   */
  private async syncWithBold(
    transaction: MembershipTransactionDocument,
  ): Promise<void> {
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
  private isBoldSyncRateLimited(
    transaction: MembershipTransactionDocument,
  ): boolean {
    const now = new Date();
    const minIntervalMs = 10_000;
    return (
      !!transaction.lastBoldSyncAt &&
      now.getTime() - new Date(transaction.lastBoldSyncAt).getTime() <
        minIntervalMs
    );
  }

  /** Map a Bold voucher body to a transaction status update + notification. */
  private async applyBoldVoucherBody(
    transaction: MembershipTransactionDocument,
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
    if (!mappedStatus || mappedStatus === transaction.status) {
      return;
    }

    this.logger.log(
      `Bold sync: updating ${transaction.reference} from ${transaction.status} to ${mappedStatus}`,
    );

    transaction.status = mappedStatus;

    if (mappedStatus === "APPROVED") {
      transaction.paidAt = new Date();
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
      await this.processApprovedPayment(transaction);
    } else if (mappedStatus === "REJECTED" || mappedStatus === "FAILED") {
      await this.sendRejectionNotification(transaction, mappedStatus);
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

  /**
   * Recupera un intento de pago de membresía por su referencia y reconstruye
   * el objeto boldConfig si el pago sigue pendiente. Esto permite que la
   * página /pagos del frontend renderice el widget de Bold o muestre el
   * estado final del pago incluso tras una recarga del navegador.
   *
   * Si el pago sigue PENDING, consulta la API de Bold (payment-voucher) como
   * mecanismo de fallback cuando el webhook no fue recibido.
   */
  async getMembershipPayment(userId: string, reference: string) {
    const transaction = await this.transactionModel.findOne({
      userId,
      reference,
    });
    if (!transaction) {
      throw new NotFoundException("Transacción de membresía no encontrada");
    }

    if (transaction.status === "PENDING") {
      await this.syncWithBold(transaction);
    }

    const result: {
      reference: string;
      type: "membership";
      paymentPlan: string;
      amount: number;
      installmentNumber: number;
      installmentTotal: number;
      isRenewal: boolean;
      status: string;
      paidAt: Date | null;
      paymentMethod: string | null;
      description: string;
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
      type: "membership",
      paymentPlan: transaction.paymentPlan,
      amount: transaction.amount,
      installmentNumber: transaction.installmentNumber,
      installmentTotal: transaction.installmentTotal,
      isRenewal: transaction.isRenewal,
      status: transaction.status,
      paidAt: transaction.paidAt,
      paymentMethod: transaction.paymentMethod ?? null,
      description: this.formatStoredMembershipDescription(
        transaction.paymentPlan,
        transaction.isRenewal,
        transaction.installmentNumber,
        transaction.installmentTotal,
      ),
      requiresPayment: transaction.status !== "APPROVED",
    };

    if (transaction.status === "PENDING") {
      result.boldConfig = this.buildBoldConfig(
        transaction.reference,
        transaction.amount,
        result.description,
      );
    }

    return result;
  }

  async getMembershipStatus(userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user) throw new NotFoundException("Usuario no encontrado");

    const now = new Date();
    const isExpired =
      user.membershipExpiryDate != null &&
      new Date(user.membershipExpiryDate) < now;

    const isInGracePeriod =
      isExpired &&
      user.membershipGracePeriodEnd != null &&
      new Date(user.membershipGracePeriodEnd) > now;

    const transactions = await this.transactionModel
      .find({ userId })
      .sort({ createdAt: -1 })
      .select("-webhookEvents -__v");

    return {
      role: user.role,
      membershipLevel: user.membershipLevel,
      membershipStartDate: user.membershipStartDate,
      membershipExpiryDate: user.membershipExpiryDate,
      membershipGracePeriodEnd: user.membershipGracePeriodEnd,
      isExpired,
      isInGracePeriod,
      membershipExpired: user.membershipExpired,
      membershipPaymentPlan: user.membershipPaymentPlan,
      installmentsPaid: user.installmentsPaid,
      installmentsTotal: user.installmentsTotal,
      renewalInstallmentsPaid: user.renewalInstallmentsPaid,
      partialPaymentCredit: user.partialPaymentCredit,
      transactions: transactions.map((t) => ({
        reference: t.reference,
        amount: t.amount,
        status: t.status,
        installmentNumber: t.installmentNumber,
        installmentTotal: t.installmentTotal,
        paymentPlan: t.paymentPlan,
        isRenewal: t.isRenewal,
        paidAt: t.paidAt,
        createdAt: t.createdAt,
      })),
    };
  }

  async chooseCreditOption(userId: string, dto: CreditChoiceDto) {
    const user = await this.usersService.findById(userId);
    if (!user) throw new NotFoundException("Usuario no encontrado");

    const credit = user.partialPaymentCredit;
    if (credit?.type !== CreditType.PENDING) {
      throw new BadRequestException(
        "No tienes crédito pendiente para administrar",
      );
    }

    const availableAmount = credit.amount - credit.usedAmount;
    if (availableAmount <= 0) {
      throw new BadRequestException(
        "Tu crédito ya ha sido utilizado por completo",
      );
    }

    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setMonth(expiresAt.getMonth() + CREDIT_EXPIRY_MONTHS);

    const timestamp = Date.now();
    const shortUserId = userId.slice(-8);
    let newType: CreditType;
    let transactionType: CreditTransactionType;
    let creditSource: CreditSource;
    let description: string;

    switch (dto.choice) {
      case "membership":
        newType = CreditType.MEMBERSHIP;
        transactionType = CreditTransactionType.CREDIT_CONVERTED_FROM_RENEWAL;
        creditSource = CreditSource.MEMBERSHIP;
        description = `Crédito de renovación parcial convertido en crédito para futura membresía (${credit.installmentsPaid} cuotas)`;
        break;
      case "services":
        newType = CreditType.SERVICES;
        transactionType = CreditTransactionType.CREDIT_GRANTED;
        creditSource = CreditSource.SERVICES;
        description = `Crédito de renovación parcial convertido en crédito para servicios BSK (${credit.installmentsPaid} cuotas)`;
        break;
      case "refund":
        newType = CreditType.REFUND_REQUESTED;
        transactionType = CreditTransactionType.CREDIT_GRANTED;
        creditSource = CreditSource.MEMBERSHIP;
        description = `Solicitud de reembolso para crédito de renovación parcial (${credit.installmentsPaid} cuotas)`;
        break;
      default:
        throw new BadRequestException("Opción de crédito inválida");
    }

    await this.usersService.updatePartialPaymentCredit(userId, {
      ...credit,
      type: newType,
      convertedAt: now,
      expiresAt: dto.choice !== "refund" ? expiresAt : null,
      refundRequestedAt: dto.choice === "refund" ? now : null,
      notes: description,
    });

    const reference = `CR-${creditSource.toUpperCase()}-${shortUserId}-${timestamp}`;
    await this.creditTransactionModel.create({
      userId,
      reference,
      transactionType,
      creditSource,
      amount: availableAmount,
      description,
      metadata: {
        installmentsPaid: credit.installmentsPaid,
        originalCreditAmount: credit.amount,
      },
    });

    this.logger.log(
      `Credit choice processed: user=${maskUserId(userId)} choice=${dto.choice} amount=${maskAmount(availableAmount)}`,
    );

    return {
      success: true,
      choice: dto.choice,
      credit: {
        type: newType,
        amount: availableAmount,
        expiresAt: dto.choice !== "refund" ? expiresAt : null,
        description,
      },
    };
  }

  async useCredit(userId: string, dto: UseCreditDto) {
    const user = await this.usersService.findById(userId);
    if (!user) throw new NotFoundException("Usuario no encontrado");

    const credit = user.partialPaymentCredit;
    if (!credit) {
      throw new BadRequestException("No tienes crédito disponible");
    }

    const expectedType =
      dto.creditSource === "membership"
        ? CreditType.MEMBERSHIP
        : CreditType.SERVICES;

    if (credit.type !== expectedType) {
      throw new BadRequestException(
        `Tu crédito es de tipo ${credit.type}, no ${dto.creditSource}`,
      );
    }

    if (this.isCreditExpired(credit, new Date())) {
      throw new BadRequestException("Tu crédito ha expirado");
    }

    const availableAmount = credit.amount - credit.usedAmount;
    if (availableAmount <= 0) {
      throw new BadRequestException(
        "Tu crédito ya ha sido utilizado por completo",
      );
    }

    if (dto.amount > availableAmount) {
      throw new BadRequestException(
        `El monto solicitado (${dto.amount}) excede tu crédito disponible (${availableAmount})`,
      );
    }

    // A-3/A-4: Use atomic $inc with optimistic locking on expectedUsedAmount
    const updated =
      await this.usersService.incrementPartialPaymentCreditUsedAmount(
        userId,
        dto.amount,
        credit.usedAmount,
      );
    if (!updated) {
      throw new ConflictException(
        "Conflicto al usar crédito: tu saldo fue modificado. Intenta de nuevo.",
      );
    }

    const timestamp = Date.now();
    const shortUserId = userId.slice(-8);
    const reference = `CRU-${shortUserId}-${timestamp}`;
    await this.creditTransactionModel.create({
      userId,
      reference,
      transactionType: CreditTransactionType.CREDIT_USED,
      creditSource: dto.creditSource,
      amount: dto.amount,
      description: dto.description ?? `Uso de crédito ${dto.creditSource}`,
    });

    this.logger.log(
      `Credit used: user=${maskUserId(userId)} amount=${maskAmount(dto.amount)} source=${dto.creditSource} remaining=${maskAmount(availableAmount - dto.amount)}`,
    );

    return {
      success: true,
      amountUsed: dto.amount,
      remainingCredit: availableAmount - dto.amount,
      reference,
    };
  }

  async getCreditBalance(userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user) throw new NotFoundException("Usuario no encontrado");

    const credit = user.partialPaymentCredit;
    if (!credit) {
      return { hasCredit: false };
    }

    const availableAmount = credit.amount - credit.usedAmount;
    const isExpired =
      credit.expiresAt != null && new Date(credit.expiresAt) < new Date();

    const transactions = await this.creditTransactionModel
      .find({ userId })
      .sort({ createdAt: -1 })
      .select("-__v");

    return {
      hasCredit: true,
      credit: {
        type: credit.type,
        totalAmount: credit.amount,
        usedAmount: credit.usedAmount,
        availableAmount: isExpired ? 0 : availableAmount,
        installmentsPaid: credit.installmentsPaid,
        createdAt: credit.createdAt,
        convertedAt: credit.convertedAt,
        expiresAt: credit.expiresAt,
        isExpired,
        refundRequestedAt: credit.refundRequestedAt,
        notes: credit.notes,
      },
      transactions: transactions.map((t) => ({
        reference: t.reference,
        transactionType: t.transactionType,
        creditSource: t.creditSource,
        amount: t.amount,
        description: t.description,
        createdAt: t.createdAt,
      })),
    };
  }

  async requestRefund(userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user) throw new NotFoundException("Usuario no encontrado");

    const credit = user.partialPaymentCredit;
    if (!credit) {
      throw new BadRequestException("No tienes crédito disponible");
    }

    if (credit.type !== CreditType.REFUND_REQUESTED) {
      throw new BadRequestException(
        "Primero debes elegir la opción de reembolso desde el panel de créditos",
      );
    }

    if (credit.usedAmount > 0) {
      throw new BadRequestException(
        "Ya has utilizado parte de tu crédito. No puedes solicitar reembolso",
      );
    }

    const timestamp = Date.now();
    const shortUserId = userId.slice(-8);
    const reference = `REF-${shortUserId}-${timestamp}`;

    await this.creditTransactionModel.create({
      userId,
      reference,
      transactionType: CreditTransactionType.CREDIT_REFUNDED,
      creditSource: CreditSource.MEMBERSHIP,
      amount: credit.amount,
      description: `Reembolso de crédito de renovación parcial (${credit.installmentsPaid} cuotas)`,
      metadata: {
        installmentsPaid: credit.installmentsPaid,
        status: "pending-admin-approval",
      },
    });

    await this.usersService.updatePartialPaymentCredit(userId, {
      ...credit,
      type: CreditType.REFUNDED,
      notes: `Reembolso solicitado - Pendiente aprobación admin. Ref: ${reference}`,
    });

    this.logger.log(
      `Refund requested: user=${maskUserId(userId)} amount=${maskAmount(credit.amount)} ref=${maskReference(reference)}`,
    );

    return {
      success: true,
      reference,
      amount: credit.amount,
      status: "pending-admin-approval",
      message:
        "Tu solicitud de reembolso ha sido registrada. Un administrador la revisará en los próximos días hábiles.",
    };
  }
}
