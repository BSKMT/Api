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
  CreatedInvoiceData,
} from "./alegra.interfaces";
import { UsersService } from "../users/users.service";
import { NotificationsService } from "../notifications/notifications.service";
import { KvCacheService } from "../kv/kv-cache.service";
import { maskReference, maskAmount } from "../common/utils/log-redact.util";
import type { EnvironmentConfig } from "../config/config.interface";
import {
  isAlegraConfigured,
  getAlegraAuthHeader,
  getAlegraBaseUrl,
  makeAlegraRequest,
} from "./alegra-http.client";
import { resolveOrEnsureContact } from "./alegra-contact.helpers";
import {
  executeCreateInvoice,
  executeCreatePayment,
  executeEmailInvoice,
  executeGetInvoicePdfUrl,
} from "./alegra-api.helpers";
import {
  executeApprovedPaymentFlow,
  executeRetryFailedInvoice,
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

  async ensureContact(userId: string): Promise<string | null> {
    if (!this.isConfigured()) return null;
    return resolveOrEnsureContact(
      userId,
      this.usersService,
      this.kvCache,
      (m, p) => this.makeRequest(m, p),
      getAlegraBaseUrl(this.configService),
      getAlegraAuthHeader(this.configService),
      this.logger,
    );
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

  async createPayment(
    invoiceId: string,
    amount: number,
  ): Promise<string | null> {
    if (!this.isConfigured()) return null;
    return executeCreatePayment(
      (m, p, b) => this.makeRequest(m, p, b),
      this.configService,
      this.kvCache,
      invoiceId,
      amount,
      this.logger,
    );
  }

  async emailInvoice(invoiceId: string): Promise<boolean> {
    if (!this.isConfigured()) return false;
    return executeEmailInvoice(
      (m, p, b) => this.makeRequest(m, p, b),
      invoiceId,
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

    const existing = await this.invoiceModel.findOne({
      transactionReference: context.transactionReference,
      purpose: context.purpose,
    });

    if (existing && existing.status !== "FAILED") {
      this.logger.log(
        `Alegra invoice already exists for ref=${maskReference(context.transactionReference)} — skipping`,
      );
      return;
    }

    this.logger.log(
      `Processing Alegra invoicing: ref=${maskReference(context.transactionReference)} purpose=${context.purpose} amount=${maskAmount(context.amount)}`,
    );

    await executeApprovedPaymentFlow(
      context,
      (uid) => this.ensureContact(uid),
      (ctx, cid) => this.createInvoice(ctx, cid),
      (iid, amt) => this.createPayment(iid, amt),
      (iid) => this.emailInvoice(iid),
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

  async getInvoicePdfUrlByTransaction(
    userId: string,
    transactionReference: string,
    purpose: string,
  ): Promise<string | null> {
    return queryInvoicePdfUrlByTransaction(
      this.invoiceModel,
      (id) => this.getInvoicePdfUrl(id),
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

  async handleWebhook(payload: AlegraWebhookPayload): Promise<void> {
    const subject = payload?.subject;
    if (!subject || typeof subject !== "string") {
      this.logger.warn("Alegra webhook received without subject");
      return;
    }

    this.logger.log(
      `Alegra webhook received: subject=${subject.slice(0, 100)}`,
    );
    try {
      if (subject.includes("invoice")) {
        await processInvoiceWebhookEvent(
          this.invoiceModel,
          payload,
          subject,
          this.logger,
        );
      } else if (subject.includes("client")) {
        this.logger.debug(`Alegra client webhook: ${subject.slice(0, 80)}`);
      } else if (subject.includes("item")) {
        this.logger.debug(`Alegra item webhook: ${subject.slice(0, 80)}`);
      }
    } catch (err: unknown) {
      this.logger.error(
        `Alegra webhook processing failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
