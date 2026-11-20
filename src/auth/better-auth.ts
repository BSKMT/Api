import { Db, MongoClient } from "mongodb";
import { Logger } from "@nestjs/common";
import type { BirdEmailService } from "../bird/bird-email.service";
import type {
  BetterAuthApiErrorCtor,
  BetterAuthCoreModule,
  BetterAuthMongoModule,
  BetterAuthDeps,
  AuthInstance,
  BetterAuthSessionData,
} from "./better-auth.types";
import { createBetterAuthHooks } from "./better-auth-hooks";
import {
  createPasswordResetCallback,
  createVerificationEmailCallback,
} from "./better-auth-email.helpers";
import {
  USER_ADDITIONAL_FIELDS,
  SESSION_ADDITIONAL_FIELDS,
  getTrustedOrigins,
  getPasskeyOrigins,
} from "./better-auth-config.helpers";
import { ensureBetterAuthIndexesAndMigrations } from "./better-auth-db.helpers";

export type {
  BetterAuthUser,
  BetterAuthSession,
  BetterAuthSessionData,
  AuthInstance,
} from "./better-auth.types";
export type Session = BetterAuthSessionData;

/**
 * Cabecera interna sobrescrita incondicionalmente por `security.ts` tras validar
 * el origen de Cloudflare, evitando spoofing de IP en sesiones y rate limiting.
 */
export const VERIFIED_CLIENT_IP_HEADER = "x-bskmt-client-ip";

interface BetterAuthExtendedDeps extends BetterAuthDeps {
  passkeyPlugin: (options?: Record<string, unknown>) => unknown;
  twoFactorPlugin: (options?: Record<string, unknown>) => unknown;
  APIError: BetterAuthApiErrorCtor;
}

let depsPromise: Promise<BetterAuthExtendedDeps> | null = null;

async function loadBetterAuthDeps(): Promise<BetterAuthExtendedDeps> {
  depsPromise ??= (async (): Promise<BetterAuthExtendedDeps> => {
    const [coreRaw, mongoRaw, passkeyRaw, twoFactorRaw, apiRaw] =
      await Promise.all([
        import("better-auth"),
        import("better-auth/adapters/mongodb"),
        import("@better-auth/passkey"),
        import("better-auth/plugins/two-factor"),
        import("better-auth/api"),
      ]);
    const core = coreRaw as unknown as BetterAuthCoreModule;
    const mongoMod = mongoRaw as unknown as BetterAuthMongoModule;
    const passkeyMod = passkeyRaw as unknown as {
      passkey: (options?: Record<string, unknown>) => unknown;
    };
    const twoFactorMod = twoFactorRaw as unknown as {
      twoFactor: (options?: Record<string, unknown>) => unknown;
    };
    const apiMod = apiRaw as unknown as {
      APIError: BetterAuthApiErrorCtor;
    };
    return {
      betterAuth: core.betterAuth,
      mongodbAdapter: mongoMod.mongodbAdapter,
      passkeyPlugin: passkeyMod.passkey,
      twoFactorPlugin: twoFactorMod.twoFactor,
      APIError: apiMod.APIError,
    };
  })();
  return depsPromise;
}

let mongoClientInstance: MongoClient | null = null;
let mongoDbInstance: Db | null = null;

function getMongoClient(): MongoClient {
  if (!mongoClientInstance) {
    const mongoUrl = process.env.MONGODB_URI;
    if (!mongoUrl) {
      throw new Error("MONGODB_URI environment variable is required");
    }
    mongoClientInstance = new MongoClient(mongoUrl, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 10_000,
      connectTimeoutMS: 10_000,
    });
  }
  return mongoClientInstance;
}

export function getMongoDb(): Db {
  mongoDbInstance ??= getMongoClient().db();
  return mongoDbInstance;
}

let authInstance: AuthInstance | null = null;
let authPromise: Promise<AuthInstance> | null = null;
let injectedEmailService: BirdEmailService | null = null;
let injectedLandingPageUrl: string | null = null;
let injectedBirdContactService:
  import("../bird/bird-contact.service").BirdContactService | null = null;

const authLogger = new Logger("BetterAuth");

export function setAuthDependencies(
  emailService: BirdEmailService,
  landingPageUrl: string,
  birdContactService?: import("../bird/bird-contact.service").BirdContactService,
): void {
  injectedEmailService = emailService;
  injectedLandingPageUrl = landingPageUrl;
  if (birdContactService) {
    injectedBirdContactService = birdContactService;
  }
  if (authInstance) {
    authLogger.warn(
      "setAuthDependencies se llamo despues de la inicializacion.",
    );
  }
}

async function initAuth(): Promise<AuthInstance> {
  const {
    betterAuth,
    mongodbAdapter,
    passkeyPlugin,
    twoFactorPlugin,
    APIError,
  } = await loadBetterAuthDeps();

  const client = getMongoClient();
  const db = getMongoDb();
  const isProd = process.env.NODE_ENV === "production";

  await ensureBetterAuthIndexesAndMigrations(db, authLogger);

  const getLandingPage = () =>
    injectedLandingPageUrl ??
    process.env.LANDING_PAGE_URL ??
    (isProd ? "https://bskmt.com" : "http://localhost:4321");

  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error("BETTER_AUTH_SECRET environment variable is required");
  }

  return betterAuth({
    appName: "BSK Motorcycle Team",
    database: mongodbAdapter(db, { client }),
    baseURL:
      process.env.BETTER_AUTH_URL ??
      (isProd ? "https://api.bskmt.com" : "http://localhost:3000"),
    secret,

    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      autoSignIn: false,
      requireEmailVerification: true,
      sendResetPassword: createPasswordResetCallback(
        () => injectedEmailService,
        getLandingPage,
        authLogger,
      ),
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 3600,
    },

    emailVerification: {
      sendVerificationEmail: createVerificationEmailCallback(
        () => injectedEmailService,
        getLandingPage,
        authLogger,
      ),
      sendOnSignUp: true,
      autoSignInAfterVerification: false,
    },

    user: {
      additionalFields: USER_ADDITIONAL_FIELDS,
    },

    session: {
      additionalFields: SESSION_ADDITIONAL_FIELDS,
      expiresIn: 7 * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
      cookieCache: { enabled: false },
    },

    rateLimit: {
      enabled: isProd,
      window: 60,
      max: 100,
      storage: "database",
      customRules: {
        "/sign-up/email": { window: 60, max: 5 },
        "/send-verification-email": { window: 300, max: 3 },
        "/verify-email": { window: 60, max: 10 },
        "/request-password-reset": { window: 300, max: 3 },
        "/forget-password": { window: 300, max: 3 },
        "/reset-password": { window: 60, max: 5 },
        "/change-password": { window: 60, max: 5 },
        "/change-email": { window: 300, max: 3 },
        "/delete-user": { window: 300, max: 3 },
        "/passkey/*": { window: 60, max: 10 },
        "/two-factor/*": { window: 60, max: 5 },
      },
    },

    advanced: {
      ipAddress: {
        ipAddressHeaders: [VERIFIED_CLIENT_IP_HEADER],
      },
      useSecureCookies: isProd,
      crossSubDomainCookies: {
        enabled: isProd,
        domain: ".bskmt.com",
      },
      defaultCookieAttributes: {
        path: "/",
        sameSite:
          process.env.COOKIE_SAME_SITE?.toLowerCase() === "strict"
            ? "strict"
            : "lax",
        secure: isProd,
        httpOnly: true,
      },
      database: {
        joins: true,
        validateSchema: false,
      },
    },

    trustedOrigins: getTrustedOrigins(),
    disabledPaths: ["/sign-in/email", "/sign-in/social"],
    databaseHooks: createBetterAuthHooks(
      db,
      authLogger,
      () => injectedBirdContactService,
      APIError,
    ),

    plugins: [
      passkeyPlugin({
        rpID: process.env.PASSKEY_RP_ID ?? (isProd ? "bskmt.com" : "localhost"),
        rpName: "BSK Motorcycle Team",
        origin: getPasskeyOrigins(),
      }),
      twoFactorPlugin({
        issuer: "BSK Motorcycle Team",
        totpOptions: {
          digits: 6,
          period: 30,
        },
        backupCodeOptions: {
          amount: 10,
          length: 10,
          storeBackupCodes: "encrypted",
        },
      }),
    ],
  });
}

export function getAuth(): Promise<AuthInstance> {
  if (authInstance) return Promise.resolve(authInstance);
  authPromise ??= initAuth().then((instance: AuthInstance): AuthInstance => {
    authInstance = instance;
    return instance;
  });
  return authPromise;
}
