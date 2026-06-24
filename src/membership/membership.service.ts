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
import { NotificationsService } from "../notifications/notifications.service";
import {
  NotificationType,
  NotificationPriority,
} from "../notifications/schemas/notification.schema";
import type { EnvironmentConfig } from "../config/config.interface";
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
    private transactionModel: Model<MembershipTransactionDocument>,
    @InjectModel(ServiceCreditTransaction.name)
    private creditTransactionModel: Model<ServiceCreditTransactionDocument>,
    private usersService: UsersService,
    private readonly notificationsService: NotificationsService,
    private configService: ConfigService<EnvironmentConfig>,
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
    const boldEnv = this.configService.get<string>("BOLD_ENVIRONMENT", {
      infer: true,
    }) ?? "sandbox";
    const effectiveSecretKey = boldEnv === "sandbox" ? "" : secretKey;
    const concatenated = `${orderId}${amount}${currency}${effectiveSecretKey}`;
    return crypto.createHash("sha256").update(concatenated).digest("hex");
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
      if ((user.role as UserRole) !== UserRole.MEMBER) {
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

    if (!isRenewal && (user.role as UserRole) === UserRole.MEMBER) {
      if (!membershipExpired) {
        throw new BadRequestException(
          "Ya tienes una membresía activa. Usa la opción de renovación anticipada.",
        );
      }
    }

    const totalAmount =
      dto.paymentPlan === "single" ? SINGLE_PAYMENT_AMOUNT : INSTALLMENT_AMOUNT;

    const installmentTotal =
      dto.paymentPlan === "single" ? 1 : INSTALLMENTS_TOTAL;

    let installmentNumber = 1;
    if (dto.paymentPlan === "installment") {
      const lastTx = await this.transactionModel
        .findOne({
          userId,
          paymentPlan: "installment",
          isRenewal,
          status: "APPROVED",
        })
        .sort({ installmentNumber: -1 });

      if (lastTx) {
        if (lastTx.installmentNumber >= INSTALLMENTS_TOTAL) {
          throw new ConflictException(
            "Ya completaste las 12 cuotas. Tu membresía debería estar activa.",
          );
        }
        installmentNumber = lastTx.installmentNumber + 1;
      }
    }

    let creditUsedAmount = 0;
    let remainingAmount = totalAmount;

    if (dto.useCredit && dto.creditAmount && dto.creditAmount > 0) {
      const credit = user.partialPaymentCredit;
      if (!credit || credit.type !== CreditType.MEMBERSHIP) {
        throw new BadRequestException(
          "No tienes crédito de membresía disponible",
        );
      }

      if (credit.expiresAt && new Date(credit.expiresAt) < now) {
        throw new BadRequestException("Tu crédito ha expirado");
      }

      const availableCredit = credit.amount - credit.usedAmount;
      if (availableCredit <= 0) {
        throw new BadRequestException(
          "Tu crédito ya ha sido utilizado por completo",
        );
      }

      creditUsedAmount = Math.min(
        dto.creditAmount,
        availableCredit,
        totalAmount,
      );
      remainingAmount = totalAmount - creditUsedAmount;

      const newUsedAmount = credit.usedAmount + creditUsedAmount;
      await this.usersService.updatePartialPaymentCredit(userId, {
        ...credit,
        usedAmount: newUsedAmount,
      });

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
        `Credit applied to membership: user=${userId} creditAmount=${creditUsedAmount} remaining=${remainingAmount}`,
      );

      if (remainingAmount === 0) {
        const memTimestamp = Date.now();
        const memShortUserId = userId.slice(-8);
        const planPrefix = dto.paymentPlan === "single" ? "MEM" : "MEMI";
        const renewSuffix = isRenewal ? "R" : "";
        const reference = `${planPrefix}${renewSuffix}-${memShortUserId}-${installmentNumber}-${memTimestamp}`;

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
          `Membership fully paid with credit: user=${userId} reference=${reference}`,
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
          description: isRenewal
            ? `Renovación anticipada membresía BSK — Cuota ${installmentNumber}/${installmentTotal} (pagada con crédito)`
            : dto.paymentPlan === "single"
              ? "Membresía Legend BSK — Pago único anual (pagado con crédito)"
              : `Membresía Legend BSK — Cuota ${installmentNumber}/${installmentTotal} (pagada con crédito)`,
        };
      }
    }

    const timestamp = Date.now();
    const shortUserId = userId.slice(-8);
    const planPrefix = dto.paymentPlan === "single" ? "MEM" : "MEMI";
    const renewSuffix = isRenewal ? "R" : "";
    const reference = `${planPrefix}${renewSuffix}-${shortUserId}-${installmentNumber}-${timestamp}`;

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

    const boldPublicKey = this.configService.get("BOLD_PUBLIC_KEY", {
      infer: true,
    })!;
    const boldIdentityKey = this.configService.get("BOLD_IDENTITY_KEY", {
      infer: true,
    })!;
    const boldEnvironment = this.configService.get("BOLD_ENVIRONMENT", {
      infer: true,
    })!;

    const boldBaseUrl =
      boldEnvironment === "production"
        ? "https://payments.api.bold.co"
        : "https://payments-api-test.bold.co";

    const description = isRenewal
      ? `Renovación anticipada membresía BSK — Cuota ${installmentNumber}/${installmentTotal}`
      : dto.paymentPlan === "single"
        ? "Membresía Legend BSK — Pago único anual"
        : `Membresía Legend BSK — Cuota ${installmentNumber}/${installmentTotal}`;

    this.logger.log(
      `Membership payment intent: ${reference} user=${userId} amount=${remainingAmount} (total=${totalAmount}, credit=${creditUsedAmount}) plan=${dto.paymentPlan} installment=${installmentNumber}/${installmentTotal} renewal=${isRenewal}`,
    );

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
      boldConfig: {
        publicKey: boldPublicKey,
        identityKey: boldIdentityKey,
        environment: boldEnvironment,
        baseUrl: boldBaseUrl,
        referenceId: reference,
        description,
        amount: remainingAmount,
        currency: "COP",
        integritySignature: this.generateBoldIntegritySignature(
          reference,
          remainingAmount,
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
      this.logger.warn("Invalid membership webhook signature");
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
      this.logger.warn("Membership webhook without reference");
      return;
    }

    const transaction = await this.transactionModel.findOne({
      reference: referenceId,
    });

    if (!transaction) {
      this.logger.warn(
        `Membership webhook for unknown reference: ${referenceId}`,
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
        `Duplicate membership webhook ignored: ${notificationId ?? paymentId}, ${referenceId}`,
      );
      return;
    }

    transaction.webhookEvents.push({
      notificationId: notificationId ?? "UNKNOWN",
      paymentId: paymentId ?? "UNKNOWN",
      type: eventType ?? "UNKNOWN",
      receivedAt: new Date(),
      data: event,
    });

    if (paymentId && !transaction.boldPaymentId) {
      transaction.boldPaymentId = paymentId;
    }

    const statusFromEvent = this.mapBoldStatus(eventType);
    if (statusFromEvent) {
      const shouldActivate = statusFromEvent === "APPROVED";
      if (shouldActivate) {
        transaction.status = "APPROVED";
        transaction.paidAt = new Date();
        if (paymentMethod) transaction.paymentMethod = paymentMethod;
        if (payerEmail) transaction.payerEmail = payerEmail;
      } else {
        transaction.status = statusFromEvent;
      }
    }

    await transaction.save();
    this.logger.log(
      `Membership webhook processed: ${eventType} for ${referenceId}`,
    );

    if (statusFromEvent === "APPROVED") {
      await this.processApprovedPayment(transaction);
    } else if (statusFromEvent === "REJECTED" || statusFromEvent === "FAILED") {
      const friendly =
        statusFromEvent === "REJECTED"
          ? "Tu pago fue rechazado por la pasarela. Puedes intentarlo de nuevo."
          : "Ocurrió un fallo procesando tu pago. Revisa tu método de pago e intenta nuevamente.";
      await this.notificationsService.create({
        userId: transaction.userId,
        type: NotificationType.MEMBERSHIP_PAYMENT_REJECTED,
        title: "Pago de membresía rechazado",
        message: `${friendly} Referencia: ${referenceId}.`,
        priority: NotificationPriority.HIGH,
        metadata: {
          paymentPlan: transaction.paymentPlan,
          installmentNumber: transaction.installmentNumber,
          installmentTotal: transaction.installmentTotal,
          status: statusFromEvent,
        },
        relatedReference: referenceId,
      });
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
      const newRenewalCount = (user.renewalInstallmentsPaid ?? 0) + 1;
      await this.usersService.updateMembershipRenewal(
        transaction.userId,
        newRenewalCount,
      );

      if (
        transaction.paymentPlan === "single" ||
        newRenewalCount >= INSTALLMENTS_TOTAL
      ) {
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
          `Membership renewed: user=${transaction.userId} expiry=${newExpiry.toISOString()}`,
        );

        await this.notificationsService.create({
          userId: transaction.userId,
          type: NotificationType.MEMBERSHIP_ACTIVATED,
          title: "Membresía renovada",
          message:
            transaction.paymentPlan === "single"
              ? `Tu renovación anual fue confirmada. Tu membresía Legend está activa hasta el ${newExpiry.toLocaleDateString("es-CO")}.`
              : `Completaste las 12 cuotas de renovación. Tu membresía Legend está activa hasta el ${newExpiry.toLocaleDateString("es-CO")}.`,
          priority: NotificationPriority.HIGH,
          metadata: {
            paymentPlan: transaction.paymentPlan,
            renewalInstallmentsPaid: newRenewalCount,
            newExpiry: newExpiry.toISOString(),
          },
          relatedReference: transaction.reference,
        });
      } else {
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
          relatedReference: transaction.reference,
        });
      }
      return;
    }

    if (transaction.paymentPlan === "single") {
      const now = new Date();
      const expiry = new Date(now.getTime() + MEMBERSHIP_DURATION_MS);
      await this.usersService.activateMembership(
        transaction.userId,
        now,
        expiry,
        "single",
      );
      this.logger.log(
        `Membership activated (single payment): user=${transaction.userId} expiry=${expiry.toISOString()}`,
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
      });
      return;
    }

    const approvedCount = await this.transactionModel.countDocuments({
      userId: transaction.userId,
      paymentPlan: "installment",
      isRenewal: false,
      status: "APPROVED",
    });

    await this.usersService.updateInstallmentsPaid(
      transaction.userId,
      approvedCount,
    );

    if (approvedCount >= INSTALLMENTS_TOTAL) {
      const now = new Date();
      const expiry = new Date(now.getTime() + MEMBERSHIP_DURATION_MS);
      await this.usersService.activateMembership(
        transaction.userId,
        now,
        expiry,
        "installments",
      );
      this.logger.log(
        `Membership activated (12 installments complete): user=${transaction.userId} expiry=${expiry.toISOString()}`,
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
      });
    } else {
      this.logger.log(
        `Installment ${approvedCount}/${INSTALLMENTS_TOTAL} paid: user=${transaction.userId}`,
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
      });
    }
  }

  /**
   * Recupera un intento de pago de membresía por su referencia y reconstruye
   * el objeto boldConfig si el pago sigue pendiente. Esto permite que la
   * página /pagos del frontend renderice el widget de Bold o muestre el
   * estado final del pago incluso tras una recarga del navegador.
   */
  async getMembershipPayment(userId: string, reference: string) {
    const transaction = await this.transactionModel.findOne({
      userId,
      reference,
    });
    if (!transaction) {
      throw new NotFoundException("Transacción de membresía no encontrada");
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
      description:
        transaction.paymentPlan === "single"
          ? transaction.isRenewal
            ? "Renovación Membresía Legend BSK — Pago único anual"
            : "Membresía Legend BSK — Pago único anual"
          : transaction.isRenewal
            ? `Renovación Membresía Legend BSK — Cuota ${transaction.installmentNumber}/${transaction.installmentTotal}`
            : `Membresía Legend BSK — Cuota ${transaction.installmentNumber}/${transaction.installmentTotal}`,
      requiresPayment: transaction.status !== "APPROVED",
    };

    if (transaction.status === "PENDING") {
      const boldPublicKey =
        this.configService.get<string>("BOLD_PUBLIC_KEY", {
          infer: true,
        }) ?? "";
      const boldEnvironment =
        this.configService.get<string>("BOLD_ENVIRONMENT", { infer: true }) ??
        "sandbox";
      const boldBaseUrl =
        boldEnvironment === "production"
          ? "https://payments.api.bold.co"
          : "https://payments-api-test.bold.co";

      result.boldConfig = {
        publicKey: boldPublicKey,
        environment: boldEnvironment,
        baseUrl: boldBaseUrl,
        referenceId: transaction.reference,
        description: result.description,
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
    if (!credit || credit.type !== CreditType.PENDING) {
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
      `Credit choice processed: user=${userId} choice=${dto.choice} amount=${availableAmount}`,
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

    if (credit.expiresAt && new Date(credit.expiresAt) < new Date()) {
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

    const newUsedAmount = credit.usedAmount + dto.amount;
    await this.usersService.updatePartialPaymentCredit(userId, {
      ...credit,
      usedAmount: newUsedAmount,
    });

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
      `Credit used: user=${userId} amount=${dto.amount} source=${dto.creditSource} remaining=${availableAmount - dto.amount}`,
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
      `Refund requested: user=${userId} amount=${credit.amount} ref=${reference}`,
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
