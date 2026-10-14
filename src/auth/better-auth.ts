import { MongoClient } from "mongodb";
import { Logger } from "@nestjs/common";
import type { BirdEmailService } from "../bird/bird-email.service";
import type {
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

interface BetterAuthExtendedDeps extends BetterAuthDeps {
  passkeyPlugin: (options?: Record<string, unknown>) => unknown;
}

let depsPromise: Promise<BetterAuthExtendedDeps> | null = null;

async function loadBetterAuthDeps(): Promise<BetterAuthExtendedDeps> {
  depsPromise ??= (async (): Promise<BetterAuthExtendedDeps> => {
    const [coreRaw, mongoRaw, passkeyRaw] = await Promise.all([
      import("better-auth"),
      import("better-auth/adapters/mongodb"),
      import("@better-auth/passkey"),
    ]);
    const core = coreRaw as unknown as BetterAuthCoreModule;
    const mongoMod = mongoRaw as unknown as BetterAuthMongoModule;
    const passkeyMod = passkeyRaw as unknown as {
      passkey: (options?: Record<string, unknown>) => unknown;
    };
    return {
      betterAuth: core.betterAuth,
      mongodbAdapter: mongoMod.mongodbAdapter,
      passkeyPlugin: passkeyMod.passkey,
    };
  })();
  return depsPromise;
}

const mongoUrl = process.env.MONGODB_URI;
if (!mongoUrl) {
  throw new Error("MONGODB_URI environment variable is required");
}

const mongoClient = new MongoClient(mongoUrl);
const mongoDb = mongoClient.db();

export function getMongoDb() {
  return mongoDb;
}

let authInstance: AuthInstance | null = null;
let authPromise: Promise<AuthInstance> | null = null;
let injectedEmailService: BirdEmailService | null = null;
let injectedLandingPageUrl: string | null = null;

const authLogger = new Logger("BetterAuth");

export function setAuthDependencies(
  emailService: BirdEmailService,
  landingPageUrl: string,
): void {
  injectedEmailService = emailService;
  injectedLandingPageUrl = landingPageUrl;
  if (authInstance) {
    authLogger.warn(
      "setAuthDependencies se llamo despues de la inicializacion.",
    );
  }
}

async function initAuth(): Promise<AuthInstance> {
  const { betterAuth, mongodbAdapter, passkeyPlugin } =
    await loadBetterAuthDeps();

  await ensureBetterAuthIndexesAndMigrations(mongoDb, authLogger);

  const getLandingPage = () =>
    injectedLandingPageUrl ??
    process.env.LANDING_PAGE_URL ??
    (process.env.NODE_ENV === "production"
      ? "https://bskmt.com"
      : "http://localhost:4321");

  return betterAuth({
    appName: "BSK Motorcycle Team",
    database: mongodbAdapter(mongoDb, { client: mongoClient }),
    baseURL:
      process.env.BETTER_AUTH_URL ??
      (process.env.NODE_ENV === "production"
        ? "https://api.bskmt.com"
        : "http://localhost:3000"),
    secret:
      process.env.BETTER_AUTH_SECRET ??
      (() => {
        throw new Error("BETTER_AUTH_SECRET environment variable is required");
      })(),

    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
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
      autoSignInAfterVerification: true,
    },

    user: {
      additionalFields: USER_ADDITIONAL_FIELDS,
    },

    session: {
      expiresIn: 60 * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },

    advanced: {
      useSecureCookies: process.env.NODE_ENV === "production",
      defaultCookieAttributes: {
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        httpOnly: true,
        ...(process.env.NODE_ENV === "production"
          ? { domain: ".bskmt.com" }
          : {}),
      },
    },

    trustedOrigins: getTrustedOrigins(),
    disabledPaths: ["/sign-in/email"],
    databaseHooks: createBetterAuthHooks(mongoDb, authLogger),

    plugins: [
      passkeyPlugin({
        rpID:
          process.env.PASSKEY_RP_ID ??
          (process.env.NODE_ENV === "production" ? "bskmt.com" : "localhost"),
        rpName: "BSK Motorcycle Team",
        origin: getPasskeyOrigins(),
      }),
    ],

    ...(process.env.GOOGLE_CLIENT_ID
      ? {
          socialProviders: {
            google: {
              clientId: process.env.GOOGLE_CLIENT_ID,
              clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
            },
          },
        }
      : {}),
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
