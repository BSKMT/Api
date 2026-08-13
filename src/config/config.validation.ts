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
});
