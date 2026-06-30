export interface EnvironmentConfig {
  MONGODB_URI: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  COOKIE_DOMAIN: string;
  COOKIE_SECURE: boolean;
  CORS_ORIGIN: string;
  PORT: number;
  BOLD_IDENTITY_KEY: string;
  BOLD_SECRET_KEY: string;
  BOLD_PUBLIC_KEY: string;
  BOLD_ENVIRONMENT: string;
}
