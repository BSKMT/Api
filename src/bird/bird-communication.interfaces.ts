// ── Email ──────────────────────────────────────────────────────────

/** Parametros para enviar un correo via Bird Email API. */
export interface BirdEmailSendParams {
  from: string | { email: string; name?: string };
  to: string[];
  subject: string;
  html?: string;
  text?: string;
  category?: "transactional" | "marketing";
  reply_to?: string[];
  tags?: { name: string; value: string }[];
  metadata?: Record<string, unknown>;
  track_opens?: boolean;
  track_clicks?: boolean;
}

/** Respuesta de Bird Email (`202 Accepted`). */
export interface BirdEmailMessage {
  readonly id: string;
  readonly status: string;
  from: { email: string; name?: string };
  to: { email: string; name?: string }[];
  subject: string;
  category: string;
}

// ── SMS ─────────────────────────────────────────────────────────────

/** Parametros para enviar un SMS via Bird SMS API. */
export interface BirdSmsSendParams {
  to: string;
  from: string;
  text: string;
  category: "transactional" | "marketing" | "authentication" | "service";
  tags?: { name: string; value: string }[];
  metadata?: Record<string, unknown>;
}

/** Respuesta de Bird SMS (`202 Accepted`). */
export interface BirdSmsMessage {
  readonly id: string;
  readonly status: string;
  to: string;
  from: string;
  text?: string;
  category?: string;
}

// ── WhatsApp ────────────────────────────────────────────────────────

/**
 * Contenido de texto plano para un mensaje WhatsApp.
 */
export interface BirdWhatsappTextContent {
  body: string;
  preview_url?: boolean;
}

/** Parametros para enviar un mensaje WhatsApp via Bird WhatsApp API. */
export interface BirdWhatsappSendParams {
  to: string;
  from?: string;
  text?: BirdWhatsappTextContent;
  template?: {
    slug?: string;
    id?: string;
    language?: string;
    components?: unknown[];
  };
  tags?: { name: string; value: string }[];
  metadata?: Record<string, unknown>;
}

/** Respuesta de Bird WhatsApp (`202 Accepted`). */
export interface BirdWhatsappMessage {
  readonly id: string;
  readonly status: string;
  to: string;
  from?: string;
  category?: string;
}

// ── Verify (OTP) ────────────────────────────────────────────────────

/** Destinatario de una verificacion Bird: email o telefono (E.164). */
export type BirdVerifyRecipient<TRecipient = unknown> = TRecipient;

export interface BirdVerifyCreateParams {
  to: { email: string } | { phone_number: string };
  options?: { code_length?: number; channels?: string[] };
  metadata?: Record<string, unknown>;
}

export interface BirdVerifyCheckParams {
  to: { email: string } | { phone_number: string };
  code: string;
}

export type BirdVerificationStatus =
  | "pending"
  | "verified"
  | "failed"
  | "expired"
  | "canceled"
  | "blocked"
  | (string & {});

export interface BirdVerificationResponse {
  id: string;
  status: BirdVerificationStatus;
  reason?: string | null;
  expires_at: string;
  verified_at?: string | null;
}

export interface BirdVerificationCheckResult {
  success: boolean;
  reason?: string | null;
  attempts_remaining?: number | null;
  verification: BirdVerificationResponse;
}
