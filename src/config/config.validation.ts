import * as Joi from "joi";

export const configValidationSchema = Joi.object({
  MONGODB_URI: Joi.string().uri().required(),
  BETTER_AUTH_SECRET: Joi.string().min(32).required(),
  BETTER_AUTH_URL: Joi.string().uri().default("http://localhost:3000"),

  CORS_ORIGIN: Joi.string().required(),
  PORT: Joi.number().default(3000),
  BOLD_IDENTITY_KEY: Joi.string().required(),
  BOLD_SECRET_KEY: Joi.string().required(),
  BOLD_PUBLIC_KEY: Joi.string().required(),
  BOLD_ENVIRONMENT: Joi.string()
    .valid("sandbox", "production", "test")
    .default("sandbox"),

  // Bird — email, SMS y verify
  BIRD_API_KEY: Joi.string()
    .allow("")
    .default("")
    .custom((value: string) => {
      if (value && !/^bk_(us1|eu1)_\S+$/.test(value)) {
        throw new Error(
          "BIRD_API_KEY debe tener formato bk_us1_... o bk_eu1_... " +
            "(key real desde Bird dashboard > Developers > API keys)",
        );
      }
      return value;
    }),
  BIRD_FROM_EMAIL: Joi.string()
    .email()
    .allow("")
    .default("no_responder@bskmt.com"),
  BIRD_FROM_NAME: Joi.string().allow("").default("BSK Motorcycle Team"),
  BIRD_TEAM_EMAIL: Joi.string().email().allow("").default("contacto@bskmt.com"),
  BIRD_SMS_SENDER: Joi.string().allow("").default("BSKMT"),

  // Bird Realtime — WebSocket hosted service.
  // All four are optional: if any required trio (APP_ID, KEY, SECRET) is
  // missing, BirdRealtimeService degrades to a no-op and the polling
  // fallback continues to work (OWASP A10 — graceful degradation).
  BIRD_REALTIME_APP_ID: Joi.string()
    .allow("")
    .default("")
    .custom((value: string) => {
      if (value && !/^rap_\S+$/.test(value)) {
        throw new Error(
          "BIRD_REALTIME_APP_ID debe tener formato rap_... (Bird Realtime dashboard)",
        );
      }
      return value;
    }),
  BIRD_REALTIME_KEY: Joi.string().allow("").default(""),
  BIRD_REALTIME_SECRET: Joi.string().allow("").default(""),
  BIRD_REALTIME_REGION: Joi.string()
    .empty("")
    .default("us1")
    .valid("us1", "eu1"),
  BIRD_WEBHOOK_SECRET: Joi.string().allow("").default(""),

  LANDING_PAGE_URL: Joi.string().uri().default("http://localhost:4321"),
  CRON_SECRET: Joi.string().min(16).required(),
  TURNSTILE_SECRET_KEY: Joi.string().allow("").default(""),

  CF_KV_ENABLED: Joi.boolean().default(false),
  CF_ACCOUNT_ID: Joi.string().allow("").when("CF_KV_ENABLED", {
    is: true,
    then: Joi.required(),
  }),
  CF_KV_NAMESPACE_ID_PUBLIC: Joi.string().allow("").when("CF_KV_ENABLED", {
    is: true,
    then: Joi.required(),
  }),
  CF_KV_NAMESPACE_ID_PRIVATE: Joi.string().allow("").when("CF_KV_ENABLED", {
    is: true,
    then: Joi.required(),
  }),
  CF_KV_API_TOKEN: Joi.string().min(32).allow("").when("CF_KV_ENABLED", {
    is: true,
    then: Joi.required(),
  }),

  ABUSEIPDB_ENABLED: Joi.boolean().default(false),
  ABUSEIPDB_API_KEY: Joi.string().allow("").when("ABUSEIPDB_ENABLED", {
    is: true,
    then: Joi.required(),
  }),
  ABUSEIPDB_BLOCK_THRESHOLD: Joi.number().min(25).max(100).default(75),

  // Verifik — KYC / identity verification (Colombia: CC, CE, PPT, PEP).
  // Optional on purpose: if the token is missing the identity-verification
  // endpoints degrade to a 503 "no disponible" instead of crashing boot,
  // mirroring the Bird degrade-to-no-op pattern (OWASP A10:2025).
  VERIFIK_API_TOKEN: Joi.string().allow("").default(""),
  VERIFIK_API_URL: Joi.string().uri().default("https://api.verifik.co"),
  VERIFIK_TIMEOUT_MS: Joi.number()
    .integer()
    .min(2000)
    .max(60000)
    .default(15000),

  // Alegra — Facturación electrónica (Colombia).
  // Optional: if ALEGRA_ENABLED is false or credentials are missing,
  // AlegraService degrades to a no-op and the payment flow continues
  // uninterrupted (OWASP A10 — graceful degradation).
  ALEGRA_ENABLED: Joi.boolean().default(false),
  ALEGRA_EMAIL: Joi.string().email().allow("").when("ALEGRA_ENABLED", {
    is: true,
    then: Joi.required(),
  }),
  ALEGRA_TOKEN: Joi.string().allow("").when("ALEGRA_ENABLED", {
    is: true,
    then: Joi.required(),
  }),
  ALEGRA_API_URL: Joi.string().uri().default("https://api.alegra.com/api/v1"),
  ALEGRA_TIMEOUT_MS: Joi.number().integer().min(5000).max(60000).default(30000),
  ALEGRA_BANK_ACCOUNT_ID: Joi.string().allow("").default(""),
  ALEGRA_SELLER_ID: Joi.string().allow("").default(""),
  ALEGRA_ITEM_ID: Joi.string().allow("").when("ALEGRA_ENABLED", {
    is: true,
    then: Joi.required(),
  }),
});
