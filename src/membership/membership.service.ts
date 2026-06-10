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
import { CreateMembershipPaymentDto } from "./dto/create-membership-payment.dto";
import { UsersService } from "../users/users.service";
import { UserRole } from "../users/schemas/user.schema";
import type { EnvironmentConfig } from "../config/config.interface";

const SINGLE_PAYMENT_AMOUNT = 2_800_000;
const INSTALLMENT_AMOUNT = 300_000;
const INSTALLMENTS_TOTAL = 12;
const MEMBERSHIP_DURATION_MS = 365 * 24 * 60 * 60 * 1000;

@Injectable()
export class MembershipService {
  private readonly logger = new Logger(MembershipService.name);

  constructor(
    @InjectModel(MembershipTransaction.name)
    private transactionModel: Model<MembershipTransactionDocument>,
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

    const amount =
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

    const timestamp = Date.now();
    const shortUserId = userId.slice(-8);
    const planPrefix = dto.paymentPlan === "single" ? "MEM" : "MEMI";
    const renewSuffix = isRenewal ? "R" : "";
    const reference = `${planPrefix}${renewSuffix}-${shortUserId}-${installmentNumber}-${timestamp}`;

    const transaction = new this.transactionModel({
      userId,
      reference,
      paymentPlan: dto.paymentPlan,
      amount,
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
      `Membership payment intent: ${reference} user=${userId} amount=${amount} plan=${dto.paymentPlan} installment=${installmentNumber}/${installmentTotal} renewal=${isRenewal}`,
    );

    return {
      reference,
      amount,
      status: "PENDING",
      installmentNumber,
      installmentTotal,
      isRenewal,
      description,
      boldConfig: {
        publicKey: boldPublicKey,
        identityKey: boldIdentityKey,
        environment: boldEnvironment,
        baseUrl: boldBaseUrl,
        referenceId: reference,
        description,
        amount,
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
}
