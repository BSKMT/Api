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
