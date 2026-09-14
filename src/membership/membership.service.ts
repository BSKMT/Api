import { Injectable, Logger } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { ConfigService } from "@nestjs/config";
import { Model } from "mongoose";
import {
  MembershipTransaction,
  MembershipTransactionDocument,
} from "./schemas/membership-transaction.schema";
import {
  ServiceCreditTransaction,
  ServiceCreditTransactionDocument,
} from "./schemas/service-credit-transaction.schema";
import { CreateMembershipPaymentDto } from "./dto/create-membership-payment.dto";
import { CreditChoiceDto } from "./dto/credit-choice.dto";
import { UseCreditDto } from "./dto/use-credit.dto";
import { UsersService } from "../users/users.service";
import { NotificationsService } from "../notifications/notifications.service";
import { AlegraService } from "../alegra/alegra.service";
import { SystemPricingConfigService } from "../admin/services/system-pricing-config.service";
import type { EnvironmentConfig } from "../config/config.interface";
import { TERMINAL_STATUSES } from "./membership.constants";
import { createMembershipPaymentHelper } from "./membership-creation.helpers";
import { processApprovedPaymentHelper } from "./membership-activation.helpers";
import { handleWebhookHelper } from "./membership-webhook.helpers";
import {
  getMembershipPaymentHelper,
  getMembershipStatusHelper,
  cancelPendingMembershipTransactionHelper,
} from "./membership-management.helpers";
import { retryMembershipInvoiceHelper } from "./membership-invoicing.helpers";
import {
  chooseCreditOptionHelper,
  requestRefundHelper,
} from "./membership-credit-choice.helpers";
import {
  useCreditHelper,
  getCreditBalanceHelper,
} from "./membership-credit-usage.helpers";
import { sweepAbandonedPaymentsHelper } from "./membership-sweep.helpers";

@Injectable()
export class MembershipService {
  private readonly logger = new Logger(MembershipService.name);

  static readonly TERMINAL_STATUSES = TERMINAL_STATUSES;

  constructor(
    @InjectModel(MembershipTransaction.name)
    private readonly transactionModel: Model<MembershipTransactionDocument>,
    @InjectModel(ServiceCreditTransaction.name)
    private readonly creditTransactionModel: Model<ServiceCreditTransactionDocument>,
    private readonly usersService: UsersService,
    private readonly notificationsService: NotificationsService,
    private readonly configService: ConfigService<EnvironmentConfig>,
    private readonly alegraService: AlegraService,
    private readonly pricingConfigService: SystemPricingConfigService,
  ) {}

  async createMembershipPayment(
    userId: string,
    dto: CreateMembershipPaymentDto,
  ) {
    return createMembershipPaymentHelper(
      {
        transactionModel: this.transactionModel,
        creditTransactionModel: this.creditTransactionModel,
        usersService: this.usersService,
        pricingConfigService: this.pricingConfigService,
        configService: this.configService,
        logger: this.logger,
        processApprovedPayment: (t) => this.processApprovedPayment(t),
      },
      userId,
      dto,
    );
  }

  async handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
    return handleWebhookHelper(
      {
        configService: this.configService,
        transactionModel: this.transactionModel,
        usersService: this.usersService,
        notificationsService: this.notificationsService,
        logger: this.logger,
        processApprovedPayment: (t) => this.processApprovedPayment(t),
      },
      rawBody,
      signature,
    );
  }

  async getMembershipPayment(userId: string, reference: string) {
    return getMembershipPaymentHelper(
      {
        configService: this.configService,
        transactionModel: this.transactionModel,
        usersService: this.usersService,
        notificationsService: this.notificationsService,
        logger: this.logger,
        processApprovedPayment: (t) => this.processApprovedPayment(t),
      },
      userId,
      reference,
    );
  }

  async getMembershipStatus(userId: string) {
    return getMembershipStatusHelper(
      {
        transactionModel: this.transactionModel,
        usersService: this.usersService,
        alegraService: this.alegraService,
      },
      userId,
    );
  }

  async cancelPendingMembershipTransaction(
    userId: string,
    reference: string,
  ): Promise<{ message: string }> {
    return cancelPendingMembershipTransactionHelper(
      {
        transactionModel: this.transactionModel,
        usersService: this.usersService,
        logger: this.logger,
      },
      userId,
      reference,
    );
  }

  async retryMembershipInvoice(
    userId: string,
    reference: string,
  ): Promise<{ message: string }> {
    return retryMembershipInvoiceHelper(
      {
        transactionModel: this.transactionModel,
        alegraService: this.alegraService,
      },
      userId,
      reference,
    );
  }

  async chooseCreditOption(userId: string, dto: CreditChoiceDto) {
    return chooseCreditOptionHelper(
      {
        usersService: this.usersService,
        creditTransactionModel: this.creditTransactionModel,
        logger: this.logger,
      },
      userId,
      dto,
    );
  }

  async useCredit(userId: string, dto: UseCreditDto) {
    return useCreditHelper(
      {
        usersService: this.usersService,
        creditTransactionModel: this.creditTransactionModel,
        logger: this.logger,
      },
      userId,
      dto,
    );
  }

  async getCreditBalance(userId: string) {
    return getCreditBalanceHelper(
      {
        usersService: this.usersService,
        creditTransactionModel: this.creditTransactionModel,
      },
      userId,
    );
  }

  async sweepAbandonedPayments(now: Date = new Date()): Promise<{
    swept: number;
    creditReverted: number;
  }> {
    return sweepAbandonedPaymentsHelper(
      {
        transactionModel: this.transactionModel,
        usersService: this.usersService,
        logger: this.logger,
      },
      now,
    );
  }

  async requestRefund(userId: string) {
    return requestRefundHelper(
      {
        usersService: this.usersService,
        creditTransactionModel: this.creditTransactionModel,
        logger: this.logger,
      },
      userId,
    );
  }

  private async processApprovedPayment(
    transaction: MembershipTransactionDocument,
  ): Promise<void> {
    return processApprovedPaymentHelper(
      {
        transactionModel: this.transactionModel,
        usersService: this.usersService,
        notificationsService: this.notificationsService,
        alegraService: this.alegraService,
        logger: this.logger,
      },
      transaction,
    );
  }
}
