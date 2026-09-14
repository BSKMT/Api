import { Injectable, Logger } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { ConfigService } from "@nestjs/config";
import { Model } from "mongoose";
import { Transaction, TransactionDocument } from "./schemas/transaction.schema";
import { CreatePaymentDto } from "./dto/create-payment.dto";
import { SubmitCompanionDto } from "./dto/submit-companion.dto";
import { EventsService } from "../events/events.service";
import { ShopService } from "../shop/shop.service";
import { ArphaService } from "../arpha/arpha.service";
import { UsersService } from "../users/users.service";
import { KvCacheService } from "../kv/kv-cache.service";
import { AlegraService } from "../alegra/alegra.service";
import type { EnvironmentConfig } from "../config/config.interface";
import {
  COURSE_TIERS,
  ARPHA_TIERS,
  SHOP_TIERS,
  TERMINAL_STATUSES,
  MEMBER_TIERS,
} from "./payments.constants";
import {
  createArphaPaymentHelper,
  createShopPaymentHelper,
} from "./payments-creation.helpers";
import {
  createEventPaymentHelper,
  createCoursePaymentHelper,
} from "./payments-event-course.helpers";
import {
  linkPaymentByPurposeHelper,
  processAlegraInvoicingHelper,
} from "./payments-linking.helpers";
import {
  handleWebhookHelper,
  getTransactionStatusHelper,
} from "./payments-status.helpers";
import {
  submitCompanionDataHelper,
  getTransactionsByUserHelper,
  cancelPendingTransactionHelper,
  retryInvoiceHelper,
  getInvoicePdfUrlHelper,
  checkPendingForPurposeHelper,
  assertNoPendingForPurposeHelper,
} from "./payments-management.helpers";

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  static readonly TERMINAL_STATUSES = TERMINAL_STATUSES;
  static readonly MEMBER_TIERS = MEMBER_TIERS;

  constructor(
    @InjectModel(Transaction.name)
    private readonly transactionModel: Model<TransactionDocument>,
    private readonly configService: ConfigService<EnvironmentConfig>,
    private readonly eventsService: EventsService,
    private readonly shopService: ShopService,
    private readonly arphaService: ArphaService,
    private readonly usersService: UsersService,
    private readonly kvCache: KvCacheService,
    private readonly alegraService: AlegraService,
  ) {}

  async createPayment(userId: string, dto: CreatePaymentDto) {
    if (ARPHA_TIERS.has(dto.tier)) {
      return createArphaPaymentHelper(
        {
          transactionModel: this.transactionModel,
          configService: this.configService,
          logger: this.logger,
        },
        userId,
        dto,
      );
    }

    const eventCourseDeps = {
      transactionModel: this.transactionModel,
      configService: this.configService,
      eventsService: this.eventsService,
      usersService: this.usersService,
      logger: this.logger,
      assertNoPendingForPurpose: (uId: string, pur: string, slug: string) =>
        this.assertNoPendingForPurpose(uId, pur, slug),
      linkPaymentByPurpose: (t: TransactionDocument) =>
        this.linkPaymentByPurpose(t),
      processAlegraInvoicing: (t: TransactionDocument) =>
        this.processAlegraInvoicing(t),
    };

    if (COURSE_TIERS.has(dto.tier)) {
      return createCoursePaymentHelper(eventCourseDeps, userId, dto);
    }

    if (SHOP_TIERS.has(dto.tier) || dto.productSlug || dto.relatedReference) {
      return createShopPaymentHelper(
        {
          transactionModel: this.transactionModel,
          configService: this.configService,
          logger: this.logger,
          shopService: this.shopService,
          processAlegraInvoicing: (t: TransactionDocument) =>
            this.processAlegraInvoicing(t),
        },
        userId,
        dto,
      );
    }

    return createEventPaymentHelper(eventCourseDeps, userId, dto);
  }

  async handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
    return handleWebhookHelper(this.getStatusDeps(), rawBody, signature);
  }

  async getTransactionStatus(userId: string, reference: string) {
    return getTransactionStatusHelper(this.getStatusDeps(), userId, reference);
  }

  async submitCompanionData(
    userId: string,
    reference: string,
    dto: SubmitCompanionDto,
  ) {
    return submitCompanionDataHelper(
      { transactionModel: this.transactionModel, logger: this.logger },
      userId,
      reference,
      dto,
    );
  }

  async getTransactionsByUser(userId: string) {
    return getTransactionsByUserHelper(
      {
        transactionModel: this.transactionModel,
        alegraService: this.alegraService,
      },
      userId,
    );
  }

  async cancelPendingTransaction(userId: string, reference: string) {
    return cancelPendingTransactionHelper(
      { transactionModel: this.transactionModel, logger: this.logger },
      userId,
      reference,
    );
  }

  async retryInvoice(userId: string, reference: string) {
    return retryInvoiceHelper(
      {
        transactionModel: this.transactionModel,
        alegraService: this.alegraService,
      },
      userId,
      reference,
    );
  }

  async getInvoicePdfUrl(userId: string, reference: string, purpose?: string) {
    return getInvoicePdfUrlHelper(
      {
        transactionModel: this.transactionModel,
        alegraService: this.alegraService,
      },
      userId,
      reference,
      purpose,
    );
  }

  async checkPendingForPurpose(
    userId: string,
    purpose: string,
    eventSlug?: string,
  ) {
    return checkPendingForPurposeHelper(
      this.transactionModel,
      userId,
      purpose,
      eventSlug,
    );
  }

  private async assertNoPendingForPurpose(
    userId: string,
    purpose: string,
    eventSlug: string,
  ) {
    return assertNoPendingForPurposeHelper(
      this.transactionModel,
      userId,
      purpose,
      eventSlug,
    );
  }

  private getStatusDeps() {
    return {
      transactionModel: this.transactionModel,
      configService: this.configService,
      kvCache: this.kvCache,
      logger: this.logger,
      linkPaymentByPurpose: (t: TransactionDocument) =>
        this.linkPaymentByPurpose(t),
      processAlegraInvoicing: (t: TransactionDocument) =>
        this.processAlegraInvoicing(t),
    };
  }

  private async linkPaymentByPurpose(
    transaction: TransactionDocument,
  ): Promise<void> {
    return linkPaymentByPurposeHelper(
      {
        shopService: this.shopService,
        arphaService: this.arphaService,
        eventsService: this.eventsService,
        logger: this.logger,
      },
      transaction,
    );
  }

  private async processAlegraInvoicing(
    transaction: TransactionDocument,
  ): Promise<void> {
    return processAlegraInvoicingHelper(
      {
        shopService: this.shopService,
        alegraService: this.alegraService,
        logger: this.logger,
      },
      transaction,
    );
  }
}
