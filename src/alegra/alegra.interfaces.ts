/**
 * TypeScript interfaces for the Alegra REST API.
 *
 * Reference: https://developer.alegra.com/reference/
 * BSKMT operates under the Colombia schema.
 *
 * IMPORTANT: Since Jan 6 2025, Alegra returns ALL IDs as strings
 * (VARCHAR(36), transitioning to UUID). Every `id` field below is
 * typed as `string` to match the current API contract.
 *
 * Security (OWASP A04:2025 — Cryptographic Failures):
 * These interfaces describe the shape of data exchanged with Alegra.
 * No secrets appear in these types. Responses are validated at the
 * service layer before use (OWASP A05 — Injection / input validation).
 */

/* ─── Contact (Client) ──────────────────────────────────────────── */

export interface AlegraContact {
  id: string;
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
  seller: { id: string; name: string } | null;
  priceList: { id: string; name: string } | null;
  term: { id: string; name: string; days: number } | null;
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
  id: string | null;
  name: string;
  description?: string;
  reference?: string;
  price: number;
  quantity: number;
  tax?: { id: string }[];
  discount?: number;
}

export interface AlegraInvoiceCreate {
  date: string;
  dueDate: string;
  client: string;
  items: AlegraInvoiceItem[];
  status?: string;
  seller?: string;
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
  id: string;
  numberTemplate?: {
    id: string;
    fullNumber: string;
  };
  date: string;
  dueDate: string;
  client: { id: string; name: string };
  status: string;
  total: number;
  balance: number;
  totalPaid: number;
  items: Array<{
    id: string;
    name: string;
    description: string | null;
    price: number;
    quantity: number;
  }>;
  stamp?: {
    id: string | null;
    status: string | null;
  } | null;
}

/* ─── Payment ───────────────────────────────────────────────────── */

export interface AlegraPaymentCreate {
  date: string;
  bankAccount: string;
  type: "in";
  paymentMethod?: string;
  invoices?: Array<{
    id: string;
    amount: number;
  }>;
}

export interface AlegraPaymentResponse {
  id: string;
  date: string;
  type: string;
  bankAccount: { id: string; name: string };
  status: string;
  total: number;
  balance: number;
}

/* ─── Item (Product/Service) ────────────────────────────────────── */

export interface AlegraItem {
  id: string;
  name: string;
  description: string | null;
  reference: string | null;
  price: Array<{ id: string; price: number }>;
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
  id: string;
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
      id: string;
      date: string;
      dueDate: string;
      status: string;
      client: { id: string };
      total: number;
      totalPaid: number;
      balance: number;
    };
    client?: {
      id: string;
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
      id: string;
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
  id: string;
  name: string;
  number: string | null;
  type: string;
  status: string;
}

/* ─── Seller ────────────────────────────────────────────────────── */

export interface AlegraSeller {
  id: string;
  name: string;
  identification: string | null;
  status: string;
}

/* ─── Tax ───────────────────────────────────────────────────────── */

export interface AlegraTax {
  id: string;
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
