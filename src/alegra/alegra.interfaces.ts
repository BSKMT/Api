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
  nameObject?: {
    firstName: string;
    secondName?: string;
    lastName: string;
    secondLastName?: string;
  };
  identification?: string;
  email?: string;
  phonePrimary?: string;
  mobile?: string;
  type: string[];
  status?: string;
  kindOfPerson?: "PERSON_ENTITY" | "LEGAL_ENTITY";
  regime?: "SIMPLIFIED_REGIME" | "COMMON_REGIME";
  identificationObject?: {
    type: string;
    number: string;
    dv?: string | null;
  };
  address?: {
    city?: string;
    department?: string;
    address?: string;
    country?: string;
  };
  settings?: {
    sendElectronicDocuments?: boolean;
  };
}

export interface ResolvedAlegraContact {
  contactId: string;
  email: string | null;
}

export interface AlegraNumberTemplate {
  id: string;
  name?: string;
  prefix?: string;
  documentType?: string;
  status?: string;
  isDefault?: boolean;
  isElectronic?: boolean;
  startDate?: string;
  endDate?: string;
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
  numberTemplate?: {
    id: string;
  };
}

export interface AlegraInvoiceResponse {
  id: string;
  numberTemplate?: {
    id: string;
    fullNumber?: string;
    prefix?: string;
    number?: string;
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

export interface AlegraBillingItem {
  name: string;
  description?: string;
  reference?: string;
  price: number;
  quantity: number;
}

export interface AlegraBillingContext {
  userId: string;
  transactionReference: string;
  purpose: string;
  amount: number;
  description: string;
  items?: AlegraBillingItem[];
  paymentMethod?: string | null;
  customerEmail?: string | null;
}

export interface AlegraInvoicePdfDetails {
  pdfUrl: string;
  invoiceNumber: string | null;
  cufe: string | null;
  stampStatus: string | null;
  status: string | null;
  balance: number | null;
}
