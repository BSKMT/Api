/**
 * TypeScript interfaces for the Alegra REST API.
 * Reference: https://developer.alegra.com/reference/
 * BSKMT operates under the Colombia schema.
 */

export type * from "./alegra-webhook.interfaces";

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
  id: string;
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
    legalStatus?: string;
    cufe?: string;
    date?: string;
    warnings?: string[];
  } | null;
  pdf?: string;
}

export interface CreatedInvoiceData {
  invoiceId: string;
  invoiceNumber: string | null;
  cufe: string | null;
  stampStatus: string | null;
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
