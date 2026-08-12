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
