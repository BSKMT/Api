import { Injectable, Logger } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { ConfigService } from "@nestjs/config";
import { Model } from "mongoose";
import {
  AlegraInvoice,
  AlegraInvoiceDocument,
} from "./schemas/alegra-invoice.schema";
import type {
  AlegraContact,
  AlegraContactCreate,
  AlegraInvoiceCreate,
  AlegraInvoiceResponse,
  AlegraPaymentCreate,
  AlegraPaymentResponse,
  AlegraWebhookPayload,
  AlegraBillingContext,
} from "./alegra.interfaces";
import {
  ALEGRA_DEFAULT_API_URL,
  ALEGRA_DEFAULT_TIMEOUT_MS,
  ALEGRA_KV_PREFIX,
  ALEGRA_CONTACT_CACHE_TTL,
  ALEGRA_CO_PAYMENT_FORM_CASH,
  ALEGRA_CO_INVOICE_TYPE_NATIONAL,
  ALEGRA_CO_OPERATION_TYPE_STANDARD,
} from "./alegra.constants";
import { UsersService } from "../users/users.service";
import { NotificationsService } from "../notifications/notifications.service";
import { KvCacheService } from "../kv/kv-cache.service";
import {
  NotificationType,
  NotificationPriority,
} from "../notifications/schemas/notification.schema";
import {
  maskUserId,
  maskReference,
  maskAmount,
} from "../common/utils/log-redact.util";
import type { EnvironmentConfig } from "../config/config.interface";

/**
 * AlegraService — Integración con la API REST de Alegra para facturación
 * electrónica, pagos, inventario y contactos.
 *
 * Punto de entrada principal: `processApprovedPayment()` — invocado
 * después de que un pago es aprobado (Bold webhook o sync) para emitir
 * la factura electrónica, registrar el pago, timbrar ante DIAN (Colombia)
 * y enviar la factura al cliente por correo.
 *
 * Seguridad (OWASP 2025):
 *  - A04: Las credenciales (email + token) se leen de variables de
 *    entorno, nunca se loguean ni se exponen en respuestas. HTTPS.
 *  - A05: Las respuestas de Alegra se validan antes de usar.
 *  - A08: Idempotencia garantizada por el índice único en
 *    (transactionReference, purpose) del schema AlegraInvoice.
 *  - A09: Todos los logs enmascaran PII (userId, email, amount).
 *  - A10: Degradación graceful — si Alegra no está configurado o falla,
 *    el flujo de pago NO se interrumpe.
 */
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

  /* ─── Configuration ────────────────────────────────────────────── */

  private isConfigured(): boolean {
    if (process.env.ALEGRA_ENABLED !== "true") return false;
    const email = this.configService.get<string>("ALEGRA_EMAIL", {
      infer: true,
    });
    const token = this.configService.get<string>("ALEGRA_TOKEN", {
      infer: true,
    });
    return !!(email && token);
  }

  private getAuthHeader(): string {
    const email = this.configService.get<string>("ALEGRA_EMAIL", {
      infer: true,
    });
    const token = this.configService.get<string>("ALEGRA_TOKEN", {
      infer: true,
    });
    const credentials = Buffer.from(`${email}:${token}`).toString("base64");
    return `Basic ${credentials}`;
  }

  private getBaseUrl(): string {
    return (
      this.configService.get<string>("ALEGRA_API_URL", { infer: true }) ??
      ALEGRA_DEFAULT_API_URL
    );
  }

  /* ─── HTTP Client ──────────────────────────────────────────────── */

  private async makeRequest<T>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<T | null> {
    if (!this.isConfigured()) {
      this.logger.debug("Alegra not configured — skipping API call");
      return null;
    }

    const url = `${this.getBaseUrl()}${path}`;
    const timeoutMs =
      Number(process.env.ALEGRA_TIMEOUT_MS) || ALEGRA_DEFAULT_TIMEOUT_MS;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const headers: Record<string, string> = {
        Authorization: this.getAuthHeader(),
        Accept: "application/json",
      };
      if (body !== undefined) {
        headers["Content-Type"] = "application/json";
      }

      const res = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (res.status === 429) {
        this.logger.warn(
          "Alegra API rate limit exceeded (150 req/min) — backing off",
        );
        return null;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        this.logger.warn(
          `Alegra API ${method} ${path} returned ${res.status}: ${text.slice(0, 200)}`,
        );
        return null;
      }

      if (res.status === 204) return null;
      return (await res.json()) as T;
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        this.logger.warn(
          `Alegra API ${method} ${path} timed out (${timeoutMs}ms)`,
        );
      } else {
        this.logger.warn(
          `Alegra API ${method} ${path} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  /* ─── Contact Management ───────────────────────────────────────── */

  async ensureContact(userId: string): Promise<string | null> {
    if (!this.isConfigured()) return null;

    const user = await this.usersService.findById(userId);
    if (!user) {
      this.logger.warn(
        `Cannot create Alegra contact — user not found: ${maskUserId(userId)}`,
      );
      return null;
    }

    const cacheKey = `${ALEGRA_KV_PREFIX}contact:${userId}`;
    const cachedId = await this.kvCache.get<string>(cacheKey, true);
    if (cachedId) return cachedId;

    const contactData = this.buildContactData(user);

    const existingByEmail = await this.findContactByEmail(user.email);
    if (existingByEmail) {
      await this.kvCache.set(
        cacheKey,
        String(existingByEmail.id),
        ALEGRA_CONTACT_CACHE_TTL,
        true,
      );
      this.logger.log(
        `Alegra contact found by email: user=${maskUserId(userId)} contactId=${existingByEmail.id}`,
      );
      return String(existingByEmail.id);
    }

    if (contactData.identification) {
      const existingById = await this.findContactByIdentification(
        contactData.identification,
      );
      if (existingById) {
        await this.kvCache.set(
          cacheKey,
          String(existingById.id),
          ALEGRA_CONTACT_CACHE_TTL,
          true,
        );
        this.logger.log(
          `Alegra contact found by identification: user=${maskUserId(userId)} contactId=${existingById.id}`,
        );
        return String(existingById.id);
      }
    }

    const created = await this.tryCreateContact(contactData);
    if (created) {
      await this.kvCache.set(cacheKey, created, ALEGRA_CONTACT_CACHE_TTL, true);
      this.logger.log(
        `Alegra contact ready: user=${maskUserId(userId)} contactId=${created}`,
      );
      return created;
    }

    this.logger.warn(
      `Failed to create/find Alegra contact for user=${maskUserId(userId)}`,
    );
    return null;
  }

  private async tryCreateContact(
    contactData: AlegraContactCreate,
  ): Promise<string | null> {
    const url = `${this.getBaseUrl()}/contacts`;
    const timeoutMs =
      Number(process.env.ALEGRA_TIMEOUT_MS) || ALEGRA_DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: this.getAuthHeader(),
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(contactData),
        signal: controller.signal,
      });

      if (res.ok) {
        const created = (await res.json()) as AlegraContact;
        if (created?.id) {
          this.logger.log(`Alegra contact created: contactId=${created.id}`);
          return String(created.id);
        }
        return null;
      }

      const text = await res.text().catch(() => "");
      this.logger.warn(
        `Alegra API POST /contacts returned ${res.status}: ${text.slice(0, 300)}`,
      );

      if (res.status === 400) {
        try {
          const error = JSON.parse(text) as {
            code?: number;
            contactId?: string;
          };
          if (error.code === 2006 && error.contactId) {
            this.logger.log(
              `Alegra contact already exists — using contactId=${error.contactId} from error response`,
            );
            return String(error.contactId);
          }
        } catch {
          // JSON parse failed — ignore
        }
      }

      return null;
    } catch (err: unknown) {
      this.logger.warn(
        `Alegra API POST /contacts failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildContactData(user: {
    email: string;
    phone?: string | null;
    identityVerification?: {
      fullName: string;
      documentType: string;
      documentNumber: string;
    } | null;
    profile?: Record<string, Record<string, unknown>>;
  }): AlegraContactCreate {
    const iv = user.identityVerification;
    const dp = user.profile?.["datos-personales"] ?? {};
    const ct = user.profile?.["contacto"] ?? {};

    const fullName =
      iv?.fullName ??
      [dp["primerNombre"], dp["primerApellido"]].filter(Boolean).join(" ") ??
      user.email;

    const identification =
      iv?.documentNumber ??
      (typeof dp["numeroDocumento"] === "string"
        ? dp["numeroDocumento"]
        : undefined);

    const phone =
      user.phone ??
      (typeof ct["telefono"] === "string" ? ct["telefono"] : undefined);

    const city = typeof ct["ciudad"] === "string" ? ct["ciudad"] : undefined;
    const addr =
      typeof ct["direccion"] === "string" ? ct["direccion"] : undefined;

    return {
      name: String(fullName).slice(0, 100),
      identification: identification
        ? String(identification).slice(0, 20)
        : undefined,
      email: user.email,
      phonePrimary: phone ? String(phone).slice(0, 50) : undefined,
      type: ["client"],
      status: "active",
      address: {
        city: city ? String(city).slice(0, 100) : undefined,
        address: addr ? String(addr).slice(0, 100) : undefined,
      },
    };
  }

  private async findContactByEmail(
    email: string,
  ): Promise<AlegraContact | null> {
    const contacts = await this.makeRequest<AlegraContact[]>(
      "GET",
      `/contacts?query=${encodeURIComponent(email)}&limit=5`,
    );
    if (!contacts || !Array.isArray(contacts)) return null;
    return (
      contacts.find((c) => c.email?.toLowerCase() === email.toLowerCase()) ??
      null
    );
  }

  private async findContactByIdentification(
    identification: string,
  ): Promise<AlegraContact | null> {
    const contacts = await this.makeRequest<AlegraContact[]>(
      "GET",
      `/contacts?query=${encodeURIComponent(identification)}&limit=5`,
    );
    if (!contacts || !Array.isArray(contacts)) return null;
    return contacts.find((c) => c.identification === identification) ?? null;
  }

  /* ─── Invoice Management ───────────────────────────────────────── */

  async createInvoice(
    context: AlegraBillingContext,
    contactId: string,
  ): Promise<string | null> {
    if (!this.isConfigured()) return null;

    const dateStr = new Date().toISOString().split("T")[0];
    const sellerId = process.env.ALEGRA_SELLER_ID || "";

    const payload: AlegraInvoiceCreate = {
      date: dateStr,
      dueDate: dateStr,
      client: contactId,
      items: this.buildInvoiceItems(context),
      status: "open",
      observations: `BSKMT — Ref: ${context.transactionReference}`,
      termsConditions:
        "BSK Motorcycle Team — Factura electrónica generada automáticamente.",
      paymentMethod: "CASH",
      paymentForm: ALEGRA_CO_PAYMENT_FORM_CASH,
      type: ALEGRA_CO_INVOICE_TYPE_NATIONAL,
      operationType: ALEGRA_CO_OPERATION_TYPE_STANDARD,
      stamp: { generateStamp: true },
    };

    if (sellerId) payload.seller = sellerId;

    const invoice = await this.makeRequest<AlegraInvoiceResponse>(
      "POST",
      "/invoices",
      payload,
    );

    if (!invoice || !invoice.id) {
      this.logger.warn(
        `Failed to create Alegra invoice for ref=${maskReference(context.transactionReference)}`,
      );
      return null;
    }

    this.logger.log(
      `Alegra invoice created: ref=${maskReference(context.transactionReference)} invoiceId=${invoice.id}`,
    );
    return String(invoice.id);
  }

  private buildInvoiceItems(
    context: AlegraBillingContext,
  ): AlegraInvoiceCreate["items"] {
    if (context.items && context.items.length > 0) {
      return context.items.map((item) => ({
        id: null,
        name: String(item.name).slice(0, 150),
        description: item.description
          ? String(item.description).slice(0, 500)
          : undefined,
        reference: item.reference
          ? String(item.reference).slice(0, 45)
          : undefined,
        price: item.price,
        quantity: item.quantity,
      }));
    }

    return [
      {
        id: null,
        name: String(context.description).slice(0, 150),
        price: context.amount,
        quantity: 1,
      },
    ];
  }

  /* ─── Payment Management ───────────────────────────────────────── */

  async createPayment(
    invoiceId: string,
    amount: number,
  ): Promise<string | null> {
    if (!this.isConfigured()) return null;
    if (amount <= 0) return null;

    const bankAccountId = process.env.ALEGRA_BANK_ACCOUNT_ID || "";

    if (!bankAccountId) {
      this.logger.warn(
        "ALEGRA_BANK_ACCOUNT_ID not configured — payment not recorded in Alegra",
      );
      return null;
    }

    const dateStr = new Date().toISOString().split("T")[0];

    const payload: AlegraPaymentCreate = {
      date: dateStr,
      bankAccount: bankAccountId,
      type: "in",
      paymentMethod: "CASH",
      invoices: [{ id: invoiceId, amount }],
    };

    const payment = await this.makeRequest<AlegraPaymentResponse>(
      "POST",
      "/payments",
      payload,
    );

    if (!payment || !payment.id) {
      this.logger.warn(
        `Failed to create Alegra payment for invoiceId=${invoiceId}`,
      );
      return null;
    }

    this.logger.log(
      `Alegra payment created: invoiceId=${invoiceId} paymentId=${payment.id} amount=${maskAmount(amount)}`,
    );
    return String(payment.id);
  }

  /* ─── Email Invoice ────────────────────────────────────────────── */

  async emailInvoice(invoiceId: string): Promise<boolean> {
    if (!this.isConfigured()) return false;

    const result = await this.makeRequest<unknown>(
      "POST",
      `/invoices/${invoiceId}/email`,
      {},
    );

    if (result === null) {
      this.logger.warn(`Failed to email Alegra invoice ${invoiceId}`);
      return false;
    }

    this.logger.log(`Alegra invoice emailed: invoiceId=${invoiceId}`);
    return true;
  }

  /* ─── Main Entry Point ─────────────────────────────────────────── */

  /**
   * Process an approved payment — the main integration point called
   * after a Bold payment is approved (webhook or sync).
   *
   * A08/A10: Idempotent + graceful degradation. All errors caught.
   */
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

    try {
      const contactId = await this.ensureContact(context.userId);
      if (!contactId) {
        await this.recordFailedInvoice(
          context,
          "Failed to create/find contact",
        );
        return;
      }

      const invoiceId = await this.createInvoice(context, contactId);
      if (!invoiceId) {
        await this.recordFailedInvoice(context, "Failed to create invoice");
        return;
      }

      let paymentId: string | null = null;
      if (context.amount > 0) {
        paymentId = await this.createPayment(invoiceId, context.amount);
      }

      const emailed = await this.emailInvoice(invoiceId);

      await this.invoiceModel.findOneAndUpdate(
        {
          transactionReference: context.transactionReference,
          purpose: context.purpose,
        },
        {
          $set: {
            userId: context.userId,
            transactionReference: context.transactionReference,
            purpose: context.purpose,
            alegraInvoiceId: invoiceId,
            alegraContactId: contactId,
            alegraPaymentId: paymentId,
            stamped: true,
            stampStatus: "STAMPED_AND_ACCEPTED",
            emailed,
            amount: context.amount,
            status: paymentId ? "PAID" : "STAMPED",
            paidAt: paymentId ? new Date() : null,
            emailedAt: emailed ? new Date() : null,
            stampedAt: new Date(),
            errorMessage: null,
          },
        },
        { upsert: true, new: true },
      );

      await this.notificationsService.create({
        userId: context.userId,
        type: NotificationType.INVOICE_CREATED,
        title: "Factura electrónica generada",
        message: `Tu factura electrónica ha sido generada${emailed ? " y enviada a tu correo" : ""}. Referencia: ${context.transactionReference}.`,
        priority: NotificationPriority.MEDIUM,
        metadata: {
          alegraInvoiceId: invoiceId,
          amount: context.amount,
          purpose: context.purpose,
        },
        relatedReference: context.transactionReference,
        notifyCategory: "Membresia y pagos",
      });

      this.logger.log(
        `Alegra invoicing completed: ref=${maskReference(context.transactionReference)} invoiceId=${invoiceId} paymentId=${paymentId ?? "n/a"} emailed=${emailed}`,
      );
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Alegra invoicing failed for ref=${maskReference(context.transactionReference)}: ${errMsg}`,
      );
      await this.recordFailedInvoice(context, errMsg);
    }
  }

  private async recordFailedInvoice(
    context: AlegraBillingContext,
    errorMessage: string,
  ): Promise<void> {
    try {
      await this.invoiceModel.findOneAndUpdate(
        {
          transactionReference: context.transactionReference,
          purpose: context.purpose,
        },
        {
          $set: {
            userId: context.userId,
            transactionReference: context.transactionReference,
            purpose: context.purpose,
            alegraInvoiceId: "0",
            alegraContactId: "0",
            amount: context.amount,
            status: "FAILED",
            errorMessage: errorMessage.slice(0, 500),
          },
        },
        { upsert: true },
      );

      await this.notificationsService.create({
        userId: context.userId,
        type: NotificationType.INVOICE_FAILED,
        title: "Inconveniente con factura electrónica",
        message:
          "Hubo un inconveniente generando tu factura electrónica. Nuestro equipo la emitirá manualmente. No afecta tu pago.",
        priority: NotificationPriority.LOW,
        metadata: {
          transactionReference: context.transactionReference,
          purpose: context.purpose,
        },
        relatedReference: context.transactionReference,
        notifyCategory: "Membresia y pagos",
      });
    } catch {
      this.logger.error(
        `Failed to record failed invoice for ref=${maskReference(context.transactionReference)}`,
      );
    }
  }

  /* ─── Webhook Handler ──────────────────────────────────────────── */

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
        await this.handleInvoiceWebhook(payload, subject);
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

  private async handleInvoiceWebhook(
    payload: AlegraWebhookPayload,
    subject: string,
  ): Promise<void> {
    const invoice = payload?.message?.invoice;
    if (!invoice || !invoice.id) {
      this.logger.warn("Alegra invoice webhook without valid invoice data");
      return;
    }

    const record = await this.invoiceModel.findOne({
      alegraInvoiceId: invoice.id,
    });

    if (!record) {
      this.logger.debug(`Alegra webhook for unknown invoiceId=${invoice.id}`);
      return;
    }

    if (subject.includes("delete")) {
      record.status = "CANCELLED";
      await record.save();
      this.logger.log(
        `Alegra invoice cancelled: invoiceId=${invoice.id} ref=${maskReference(record.transactionReference)}`,
      );
      return;
    }

    if (subject.includes("edit") || subject.includes("new")) {
      if (invoice.balance === 0 && record.status !== "PAID") {
        record.status = "PAID";
        record.paidAt = new Date();
        await record.save();
        this.logger.log(
          `Alegra invoice marked paid: invoiceId=${invoice.id} ref=${maskReference(record.transactionReference)}`,
        );
      }
    }
  }
}
