import * as Joi from "joi";

export const configValidationSchema = Joi.object({
  MONGODB_URI: Joi.string().uri().default("mongodb://localhost:27017/bskmt"),
  BETTER_AUTH_SECRET: Joi.string().min(32).default("fallback-secret-change-me"),
  BETTER_AUTH_URL: Joi.string().uri().default("http://localhost:3000"),
  COOKIE_DOMAIN: Joi.string().default("bskmt.com"),
  COOKIE_SECURE: Joi.string().valid("true", "false").default("true"),
  CORS_ORIGIN: Joi.string().default("https://bskmt.com"),
  PORT: Joi.number().default(3000),
  BOLD_IDENTITY_KEY: Joi.string().optional(),
  BOLD_SECRET_KEY: Joi.string().optional(),
  BOLD_PUBLIC_KEY: Joi.string().optional(),
  BOLD_ENVIRONMENT: Joi.string()
    .valid("sandbox", "production", "test")
    .default("sandbox"),
});
