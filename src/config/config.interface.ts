export interface EnvironmentConfig {
  MONGODB_URI: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;

  CORS_ORIGIN: string;
  PORT: number;
  BOLD_IDENTITY_KEY: string;
  BOLD_SECRET_KEY: string;
  BOLD_PUBLIC_KEY: string;
  BOLD_ENVIRONMENT: string;

  /**
   * Bird — API unificada para email, SMS y verify.
   * La key (bk_{region}_...) selecciona la region automaticamente.
   */
  BIRD_API_KEY: string;
  BIRD_FROM_EMAIL: string;
  BIRD_FROM_NAME: string;
  BIRD_TEAM_EMAIL: string;
  BIRD_SMS_SENDER: string;

  /**
   * Bird Realtime — WebSocket hosted service for realtime events.
   *
   * - BIRD_REALTIME_APP_ID:  The Realtime app id (`rap_…`) used in
   *   publish/disconnect API paths.
   * - BIRD_REALTIME_KEY:     Public key — safe to ship to the browser
   *   (the Astro frontend reads its own copy via `PUBLIC_BIRD_REALTIME_KEY`).
   * - BIRD_REALTIME_SECRET:  App secret — signs channel authorizations and
   *   member identities server-side. NEVER exposed to the client.
   * - BIRD_REALTIME_REGION:  `us1` or `eu1` — pinned at app creation.
   *
   * Security (OWASP A04:2025 — Cryptographic Failures):
   *   The secret is only read server-side and used for HMAC-SHA256 signing.
   *   It is never logged, never returned in API responses, and never
   *   forwarded to the Astro Worker. If any of the three required values
   *   (APP_ID, KEY, SECRET) is missing, `BirdRealtimeService` degrades to
   *   a no-op and the polling fallback continues to deliver notifications.
   *   (OWASP A10:2025 — Server-Side Request Forgery / degradable design.)
   */
  BIRD_REALTIME_APP_ID: string;
  BIRD_REALTIME_KEY: string;
  BIRD_REALTIME_SECRET: string;
  BIRD_REALTIME_REGION: string;
  /** Bird Webhook signing secret for verifying realtime.* deliveries. */
  BIRD_WEBHOOK_SECRET: string;

  LANDING_PAGE_URL: string;
  /**
   * A-7: Secret shared between Vercel Cron and the `/api/internal/cron/*`
   * and `/api/membership/internal/cron/*` endpoints. Without it (or if a
   * request is missing the matching `X-Cron-Secret` header or
   * `Authorization: Bearer <secret>`), the cron endpoint 400s.
   */
  CRON_SECRET: string;
  TURNSTILE_SECRET_KEY: string;

  CF_KV_ENABLED: boolean;
  CF_ACCOUNT_ID: string;
  CF_KV_NAMESPACE_ID_PUBLIC: string;
  CF_KV_NAMESPACE_ID_PRIVATE: string;
  CF_KV_API_TOKEN: string;

  /**
   * AbuseIPDB — IP reputation checking.
   * When ABUSEIPDB_ENABLED is true, the API rejects requests from IPs
   * with an AbuseIPDB abuseConfidenceScore >= ABUSEIPDB_BLOCK_THRESHOLD.
   * The API key is sent via the `Key` HTTP header (never in the query
   * string) per AbuseIPDB security guidance.
   */
  ABUSEIPDB_ENABLED: boolean;
  ABUSEIPDB_API_KEY: string;
  ABUSEIPDB_BLOCK_THRESHOLD: number;
}
