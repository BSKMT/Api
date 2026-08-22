/**
 * TypeScript interfaces for the Alegra REST API.
 *
 * Reference: Docs_Alegra/ — schemas are country-specific (oneOf).
 * BSKMT operates under the Colombia schema.
 *
 * Security (OWASP A04:2025 — Cryptographic Failures):
 * These interfaces describe the shape of data exchanged with Alegra.
 * No secrets appear in these types. Responses are validated at the
 * service layer before use (OWASP A05 — Injection / input validation).
 */

/* ─── Contact (Client) ──────────────────────────────────────────── */

export interface AlegraContact {
  id: number;
  name: string;
  identification: string | null;
  email: string | null;
  phonePrimary: string | null;
  phoneSecondary: string | null;
  mobile: string | null;
  type: string[];
  status: string;
  address: {
    city: string | null;
    address: string | null;
  } | null;
  seller: { id: number; name: string } | null;
  priceList: { id: number; name: string } | null;
  term: { id: number; name: string; days: number } | null;
}

export interface AlegraContactCreate {
  name: string;
  identification?: string;
  email?: string;
  phonePrimary?: string;
  mobile?: string;
  type: string[];
  status?: string;
  address?: {
    city?: string;
    address?: string;
  };
}

/* ─── Invoice ───────────────────────────────────────────────────── */

export interface AlegraInvoiceItem {
  id: number | null;
  name: string;
  description?: string;
  reference?: string;
  price: number;
  quantity: number;
  tax?: { id: number }[];
  discount?: number;
}

export interface AlegraInvoiceCreate {
  date: string;
  dueDate: string;
  client: number;
  items: AlegraInvoiceItem[];
  status?: string;
  seller?: number;
  observations?: string;
  termsConditions?: string;
  paymentMethod?: string;
  paymentForm?: string;
  type?: string;
  operationType?: string;
  stamp?: {
    generateStamp?: boolean;
  };
}

export interface AlegraInvoiceResponse {
  id: number;
  numberTemplate?: {
    id: number;
    fullNumber: string;
  };
  date: string;
  dueDate: string;
  client: { id: number; name: string };
  status: string;
  total: number;
  balance: number;
  totalPaid: number;
  items: Array<{
    id: number;
    name: string;
    description: string | null;
    price: number;
    quantity: number;
  }>;
  stamp?: {
    id: number | null;
    status: string | null;
  } | null;
}

/* ─── Payment ───────────────────────────────────────────────────── */

export interface AlegraPaymentCreate {
  date: string;
  bankAccount: number;
  type: "in";
  paymentMethod?: string;
  invoices?: Array<{
    id: number;
    amount: number;
  }>;
}

export interface AlegraPaymentResponse {
  id: number;
  date: string;
  type: string;
  bankAccount: { id: number; name: string };
  status: string;
  total: number;
  balance: number;
}

/* ─── Item (Product/Service) ────────────────────────────────────── */

export interface AlegraItem {
  id: number;
  name: string;
  description: string | null;
  reference: string | null;
  price: Array<{ id: number; price: number }>;
  type: string;
  inventory: {
    unit: string;
    availableQuantity: number;
    unitCost: number;
    initialQuantity: number;
  } | null;
  status: string;
}

export interface AlegraItemCreate {
  name: string;
  price: number;
  description?: string;
  reference?: string;
  type?: string;
  inventory?: {
    unit: string;
    availableQuantity?: number;
    unitCost?: number;
    initialQuantity?: number;
  };
}

/* ─── Webhook Subscription ──────────────────────────────────────── */

export interface AlegraWebhookSubscription {
  id: number;
  event: string;
  url: string;
}

export interface AlegraWebhookSubscriptionCreate {
  event: string;
  url: string;
}

/* ─── Webhook Event Payloads ────────────────────────────────────── */

export interface AlegraWebhookPayload {
  subject: string;
  message: {
    invoice?: {
      id: number;
      date: string;
      dueDate: string;
      status: string;
      client: { id: number };
      total: number;
      totalPaid: number;
      balance: number;
    };
    client?: {
      id: number;
      name: {
        firstName: string;
        secondName: string | null;
        lastName: string | null;
        secondLastName: string | null;
      };
      email: string | null;
      identification: string | null;
    };
    item?: {
      id: number;
      name: string;
      description: string | null;
      reference: string | null;
      inventory: {
        unit: string;
        availableQuantity: number;
      } | null;
    };
  };
}

/* ─── Bank Account ──────────────────────────────────────────────── */

export interface AlegraBankAccount {
  id: number;
  name: string;
  number: string | null;
  type: string;
  status: string;
}

/* ─── Seller ────────────────────────────────────────────────────── */

export interface AlegraSeller {
  id: number;
  name: string;
  identification: string | null;
  status: string;
}

/* ─── Tax ───────────────────────────────────────────────────────── */

export interface AlegraTax {
  id: number;
  name: string;
  percentage: number;
  status: string;
}

/* ─── API Error ─────────────────────────────────────────────────── */

export interface AlegraApiError {
  code: string;
  message: string;
}

/* ─── Internal DTOs ─────────────────────────────────────────────── */

export interface AlegraBillingContext {
  userId: string;
  transactionReference: string;
  purpose: string;
  amount: number;
  description: string;
  items?: Array<{
    name: string;
    description?: string;
    reference?: string;
    price: number;
    quantity: number;
  }>;
  paymentMethod?: string;
}
