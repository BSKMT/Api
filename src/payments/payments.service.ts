import {
  BadRequestException,
  Injectable,
  Logger,
  Optional,
} from "@nestjs/common";
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
import { MembershipService } from "../membership/membership.service";
import { SecurityAuditService } from "../common/audit/security-audit.service";
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
    @Optional() private readonly membershipService?: MembershipService,
    @Optional() private readonly auditService?: SecurityAuditService,
  ) { }

  async createPayment(userId: string, dto: CreatePaymentDto) {
    if (ARPHA_TIERS.has(dto.tier)) {
      return createArphaPaymentHelper(
        {
          transactionModel: this.transactionModel,
          configService: this.configService,
          arphaService: this.arphaService,
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

  /**
   * handleWebhookBatch - Procesa en lote eventos de webhooks provenientes
   * del amortiguador perimetral de Cloudflare Queues (bskmt-webhooks-queue).
   */
  async handleWebhookBatch(
    items: Array<{ id: string; body: { rawBody: string; signature: string } }>,
  ): Promise<{ processed: number; failed: number; failedIds: string[] }> {
    const results = await Promise.allSettled(
      items.map(async (item) => {
        if (!item?.body?.rawBody || !item?.body?.signature) {
          throw new BadRequestException(`Invalid item payload for ${item?.id}`);
        }
        const rawBuf = Buffer.from(item.body.rawBody, "utf-8");
        return handleWebhookHelper(
          this.getStatusDeps(),
          rawBuf,
          item.body.signature,
        );
      }),
    );

    let processed = 0;
    let failed = 0;
    const failedIds: string[] = [];

    for (let i = 0; i < results.length; i++) {
      const res = results[i];
      if (res.status === "fulfilled") {
        processed++;
      } else {
        failed++;
        const itemId = items[i]?.id;
        // Only mark transient (non-400) errors as retryable so invalid signatures don't poison the queue
        if (itemId && !(res.reason instanceof BadRequestException)) {
          failedIds.push(itemId);
        }
        this.logger.error(
          `Failed to process batched webhook ${itemId}: ${res.reason instanceof Error ? res.reason.message : String(res.reason)}`,
        );
      }
    }

    return { processed, failed, failedIds };
  }

  async getTransactionStatus(
    userId: string,
    reference: string,
  ): Promise<Record<string, unknown>> {
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
      {
        transactionModel: this.transactionModel,
        logger: this.logger,
        kvCache: this.kvCache,
      },
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
      auditService: this.auditService,
      linkPaymentByPurpose: (t: TransactionDocument) =>
        this.linkPaymentByPurpose(t),
      processAlegraInvoicing: (t: TransactionDocument) =>
        this.processAlegraInvoicing(t),
      delegateMembershipWebhook: this.membershipService
        ? (
          event: Record<string, unknown>,
          parsed: Parameters<MembershipService["handleVerifiedWebhook"]>[1],
        ) => this.membershipService!.handleVerifiedWebhook(event, parsed)
        : undefined,
      getMembershipPayment: this.membershipService
        ? (userId: string, reference: string) =>
          this.membershipService!.getMembershipPayment(userId, reference)
        : undefined,
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
