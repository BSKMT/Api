import * as Joi from "joi";

export const configValidationSchema = Joi.object({
  MONGODB_URI: Joi.string().uri().required(),
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRATION: Joi.string().default("15m"),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_EXPIRATION: Joi.string().default("7d"),
  COOKIE_DOMAIN: Joi.string().required(),
  COOKIE_SECURE: Joi.string().valid("true", "false").default("true"),
  CORS_ORIGIN: Joi.string().required(),
  PORT: Joi.number().default(3000),
  CSRF_SECRET: Joi.string().min(32).required(),
  BCRYPT_SALT_ROUNDS: Joi.number().min(10).max(14).default(12),
  BOLD_IDENTITY_KEY: Joi.string().required(),
  BOLD_SECRET_KEY: Joi.string().required(),
  BOLD_PUBLIC_KEY: Joi.string().required(),
  BOLD_ENVIRONMENT: Joi.string().valid("sandbox", "production").default("sandbox"),
});
