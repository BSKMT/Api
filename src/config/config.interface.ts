export interface EnvironmentConfig {
  MONGODB_URI: string;
  JWT_SECRET: string;
  JWT_EXPIRATION: string;
  JWT_REFRESH_SECRET: string;
  JWT_REFRESH_EXPIRATION: string;
  COOKIE_DOMAIN: string;
  COOKIE_SECURE: boolean;
  CORS_ORIGIN: string;
  PORT: number;
  CSRF_SECRET: string;
  BCRYPT_SALT_ROUNDS: number;
}
