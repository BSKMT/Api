import * as Joi from "joi";

export const configValidationSchema = Joi.object({
  MONGODB_URI: Joi.string().uri().required(),
  BETTER_AUTH_SECRET: Joi.string().min(32).required(),
  BETTER_AUTH_URL: Joi.string().uri().default("http://localhost:3000"),
  COOKIE_DOMAIN: Joi.string().required(),
  COOKIE_SECURE: Joi.string().valid("true", "false").default("true"),
  CORS_ORIGIN: Joi.string().required(),
  PORT: Joi.number().default(3000),
  BOLD_IDENTITY_KEY: Joi.string().required(),
  BOLD_SECRET_KEY: Joi.string().required(),
  BOLD_PUBLIC_KEY: Joi.string().required(),
  BOLD_ENVIRONMENT: Joi.string()
    .valid("sandbox", "production", "test")
    .default("sandbox"),
});