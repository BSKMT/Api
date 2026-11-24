import { Injectable, Logger } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { ConfigService } from "@nestjs/config";
import { Model } from "mongoose";
import {
  AlegraInvoice,
  AlegraInvoiceDocument,
} from "./schemas/alegra-invoice.schema";
import type {
  AlegraWebhookPayload,
  AlegraBillingContext,
  AlegraInvoicePdfDetails,
  CreatedInvoiceData,
  ResolvedAlegraContact,
} from "./alegra.interfaces";
import { UsersService } from "../users/users.service";
import { NotificationsService } from "../notifications/notifications.service";
import { KvCacheService } from "../kv/kv-cache.service";
import {
  maskReference,
  maskAmount,
  sanitizeForLog,
} from "../common/utils/log-redact.util";
import type { EnvironmentConfig } from "../config/config.interface";
import {
  isAlegraConfigured,
  makeAlegraDetailedRequest,
  makeAlegraRequest,
  type AlegraDetailedResponse,
} from "./alegra-http.client";
import { resolveOrEnsureContact } from "./alegra-contact.helpers";
import {
  executeCreateInvoice,
  executeCreateInvoiceDetailed,
  executeCreatePayment,
  executeEmailInvoice,
  executeGetInvoicePdfDetails,
  executeGetInvoicePdfUrl,
  type CreateInvoiceDetailedResult,
} from "./alegra-api.helpers";
import {
  claimInvoiceProcessingLock,
  executeApprovedPaymentFlow,
  executeRetryFailedInvoice,
  executeRetryFailedInvoiceDetailed,
  type RetryFailedInvoiceOutcome,
} from "./alegra-payment.helpers";
import {
  queryInvoicesForUser,
  queryInvoicePdfUrlByTransaction,
} from "./alegra-query.helpers";
import { processInvoiceWebhookEvent } from "./alegra-webhook.helpers";

@Injectable()
export class AlegraService {
  private readonly logger = new Logger(AlegraService.name);

  constructor(
    @InjectModel(AlegraInvoice.name)
    private readonly invoiceModel: Model<AlegraInvoiceDocument>,
    private readonly configService: ConfigService<EnvironmentConfig>,
    private readonly usersService: UsersService,
    private readonly notificationsService: NotificationsService,
    private readonly kvCache: KvCacheService,
  ) {}

  private isConfigured(): boolean {
    return isAlegraConfigured(this.configService);
  }

  private async makeRequest<T>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<T | null> {
    return makeAlegraRequest<T>(
      this.configService,
      this.logger,
      method,
      path,
      body,
    );
  }

  private async makeDetailedRequest<T>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<AlegraDetailedResponse<T>> {
    return makeAlegraDetailedRequest<T>(
      this.configService,
      this.logger,
      method,
      path,
      body,
    );
  }

  private async resolveContact(
    userId: string,
  ): Promise<ResolvedAlegraContact | null> {
    if (!this.isConfigured()) return null;
    return resolveOrEnsureContact(
      userId,
      this.usersService,
      this.kvCache,
      (m, p) => this.makeRequest(m, p),
      (m, p, b) => this.makeDetailedRequest(m, p, b),
      this.logger,
    );
  }

  async ensureContact(userId: string): Promise<string | null> {
    const resolved = await this.resolveContact(userId);
    return resolved?.contactId ?? null;
  }

  async createInvoice(
    context: AlegraBillingContext,
    contactId: string,
  ): Promise<CreatedInvoiceData | null> {
    if (!this.isConfigured()) return null;
    return executeCreateInvoice(
      (m, p, b) => this.makeRequest(m, p, b),
      this.configService,
      this.kvCache,
      context,
      contactId,
      this.logger,
    );
  }

  async createInvoiceDetailed(
    context: AlegraBillingContext,
    contactId: string,
  ): Promise<CreateInvoiceDetailedResult> {
    if (!this.isConfigured()) {
      return { data: null, errorCode: "Alegra not configured" };
    }
    return executeCreateInvoiceDetailed(
      (m, p, b) => this.makeRequest(m, p, b),
      (m, p, b) => this.makeDetailedRequest(m, p, b),
      this.configService,
      this.kvCache,
      context,
      contactId,
      this.logger,
    );
  }

  async createPayment(
    invoiceId: string,
    amount: number,
    paymentMethod?: string | null,
  ): Promise<string | null> {
    if (!this.isConfigured()) return null;
    return executeCreatePayment(
      (m, p, b) => this.makeRequest(m, p, b),
      this.configService,
      this.kvCache,
      invoiceId,
      amount,
      this.logger,
      paymentMethod,
    );
  }

  async emailInvoice(
    invoiceId: string,
    recipientEmail?: string | null,
  ): Promise<boolean> {
    if (!this.isConfigured()) return false;
    return executeEmailInvoice(
      (m, p, b) => this.makeRequest(m, p, b),
      invoiceId,
      recipientEmail,
      this.logger,
    );
  }

  async processApprovedPayment(context: AlegraBillingContext): Promise<void> {
    if (!this.isConfigured()) {
      this.logger.debug(
        `Alegra not configured — skipping invoicing for ref=${maskReference(context.transactionReference)}`,
      );
      return;
    }

    if (!Number.isFinite(context.amount) || context.amount <= 0) {
      this.logger.debug(
        `Zero/non-positive amount for ref=${maskReference(context.transactionReference)} — skipping DIAN electronic invoice`,
      );
      return;
    }

    const claimed = await claimInvoiceProcessingLock(
      this.invoiceModel,
      context,
      this.logger,
    );
    if (!claimed) {
      return;
    }

    this.logger.log(
      `Processing Alegra invoicing: ref=${maskReference(context.transactionReference)} purpose=${context.purpose} amount=${maskAmount(context.amount)}`,
    );

    await executeApprovedPaymentFlow(
      context,
      {
        ensureContactFn: (uid) => this.resolveContact(uid),
        createInvoiceFn: (ctx, cid) => this.createInvoice(ctx, cid),
        createInvoiceDetailedFn: (ctx, cid) =>
          this.createInvoiceDetailed(ctx, cid),
        createPaymentFn: (iid, amt, pm) => this.createPayment(iid, amt, pm),
        emailInvoiceFn: (iid, email) => this.emailInvoice(iid, email),
      },
      this.invoiceModel,
      this.notificationsService,
      this.logger,
    );
  }

  async getInvoicesForUser(
    userId: string,
  ): Promise<Map<string, AlegraInvoiceDocument>> {
    return queryInvoicesForUser(this.invoiceModel, userId);
  }

  async getInvoicePdfUrl(invoiceId: string): Promise<string | null> {
    if (!this.isConfigured()) return null;
    return executeGetInvoicePdfUrl(
      (m, p) => this.makeRequest(m, p),
      invoiceId,
      this.logger,
    );
  }

  private async getInvoicePdfDetails(
    invoiceId: string,
  ): Promise<AlegraInvoicePdfDetails | null> {
    if (!this.isConfigured()) return null;
    return executeGetInvoicePdfDetails(
      (m, p) => this.makeRequest(m, p),
      invoiceId,
      this.logger,
    );
  }

  async getInvoicePdfUrlByTransaction(
    userId: string,
    transactionReference: string,
    purpose?: string,
  ): Promise<string | null> {
    return queryInvoicePdfUrlByTransaction(
      this.invoiceModel,
      (id) => this.getInvoicePdfDetails(id),
      userId,
      transactionReference,
      purpose,
    );
  }

  async retryFailedInvoice(
    transactionReference: string,
    purpose: string,
  ): Promise<boolean> {
    return executeRetryFailedInvoice(
      this.invoiceModel,
      (ctx) => this.processApprovedPayment(ctx),
      transactionReference,
      purpose,
      this.logger,
    );
  }

  async retryFailedInvoiceDetailed(
    transactionReference: string,
    purpose: string,
  ): Promise<RetryFailedInvoiceOutcome> {
    return executeRetryFailedInvoiceDetailed(
      this.invoiceModel,
      (ctx) => this.processApprovedPayment(ctx),
      transactionReference,
      purpose,
      this.logger,
    );
  }

  async handleWebhook(payload: AlegraWebhookPayload): Promise<void> {
    const subject = payload?.subject;
    if (!subject || typeof subject !== "string") {
      this.logger.warn("Alegra webhook received without subject");
      return;
    }

    const safeSubject = sanitizeForLog(subject.slice(0, 100));
    this.logger.log(`Alegra webhook received: subject=${safeSubject}`);
    try {
      if (safeSubject.toLowerCase().includes("invoice")) {
        await processInvoiceWebhookEvent(
          this.invoiceModel,
          payload,
          safeSubject,
          this.logger,
        );
      } else if (safeSubject.toLowerCase().includes("client")) {
        this.logger.debug(`Alegra client webhook: ${safeSubject.slice(0, 80)}`);
      } else if (safeSubject.toLowerCase().includes("item")) {
        this.logger.debug(`Alegra item webhook: ${safeSubject.slice(0, 80)}`);
      }
    } catch (err: unknown) {
      this.logger.error(
        `Alegra webhook processing failed: ${sanitizeForLog(err instanceof Error ? err.message : String(err))}`,
      );
    }
  }
}
