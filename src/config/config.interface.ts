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
  ZOHO_CLIENT_ID: string;
  ZOHO_CLIENT_SECRET: string;
  ZOHO_REFRESH_TOKEN: string;
  ZOHO_ACCOUNT_ID: string;
  ZOHO_FROM_ADDRESS: string;
  ZOHO_TEAM_EMAIL: string;
  ZOHO_API_BASE: string;
  ZOHO_TOKEN_BASE: string;
  LANDING_PAGE_URL: string;
}
