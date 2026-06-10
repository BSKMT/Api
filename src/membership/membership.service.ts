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
    private configService: ConfigService<EnvironmentConfig>,
  ) {}

  async createMembershipPayment(
    userId: string,
    dto: CreateMembershipPaymentDto,
  ) {
    const user = await this.usersService.findById(userId);
    if (!user) throw new NotFoundException("Usuario no encontrado");

    const isRenewal = dto.isRenewal === true;
    const now = new Date();
    const membershipExpired =
      user.membershipExpiryDate !== null &&
      new Date(user.membershipExpiryDate) < now;
    const isInGracePeriod =
      membershipExpired &&
      user.membershipGracePeriodEnd !== null &&
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
      },
    };
  }

  async handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
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
      this.logger.warn("Invalid membership webhook signature");
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
      this.logger.warn("Membership webhook without referenceId");
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

    const alreadyProcessed = transaction.webhookEvents.some(
      (e) =>
        paymentId !== undefined &&
        e["paymentId"] === paymentId &&
        e["type"] === eventType,
    );

    if (alreadyProcessed) {
      this.logger.log(
        `Duplicate membership webhook ignored: ${paymentId}, ${referenceId}`,
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

    if (eventType === "PAYMENT_APPROVED") {
      transaction.status = "APPROVED";
      transaction.paidAt = new Date();
      if (event["paymentMethod"])
        transaction.paymentMethod = event["paymentMethod"] as string;
      if (event["payerEmail"])
        transaction.payerEmail = event["payerEmail"] as string;
    } else if (eventType === "PAYMENT_REJECTED") {
      transaction.status = "REJECTED";
    } else if (eventType === "PAYMENT_VOIDED") {
      transaction.status = "VOIDED";
    } else if (eventType === "PAYMENT_FAILED") {
      transaction.status = "FAILED";
    }

    await transaction.save();
    this.logger.log(
      `Membership webhook processed: ${eventType} for ${referenceId}`,
    );

    if (eventType === "PAYMENT_APPROVED") {
      await this.processApprovedPayment(transaction);
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
    } else {
      this.logger.log(
        `Installment ${approvedCount}/${INSTALLMENTS_TOTAL} paid: user=${transaction.userId}`,
      );
    }
  }

  async getMembershipStatus(userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user) throw new NotFoundException("Usuario no encontrado");

    const now = new Date();
    const isExpired =
      user.membershipExpiryDate !== null &&
      new Date(user.membershipExpiryDate) < now;

    const isInGracePeriod =
      isExpired &&
      user.membershipGracePeriodEnd !== null &&
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
      credit.expiresAt !== null && new Date(credit.expiresAt) < new Date();

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
