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

export type {
  BetterAuthUser,
  BetterAuthSession,
  BetterAuthSessionData,
  AuthInstance,
} from "./better-auth.types";
export type Session = BetterAuthSessionData;

let depsPromise: Promise<BetterAuthDeps> | null = null;

async function loadBetterAuthDeps(): Promise<BetterAuthDeps> {
  depsPromise ??= (async (): Promise<BetterAuthDeps> => {
    const [coreRaw, mongoRaw] = await Promise.all([
      import("better-auth"),
      import("better-auth/adapters/mongodb"),
    ]);
    const core = coreRaw as unknown as BetterAuthCoreModule;
    const mongoMod = mongoRaw as unknown as BetterAuthMongoModule;
    return {
      betterAuth: core.betterAuth,
      mongodbAdapter: mongoMod.mongodbAdapter,
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
  const { betterAuth, mongodbAdapter } = await loadBetterAuthDeps();

  try {
    const migrationResult = await mongoDb.collection("account").updateMany(
      {
        providerId: "credential",
        $or: [{ issuer: { $exists: false } }, { issuer: null }, { issuer: "" }],
      },
      {
        $set: { issuer: "local:credential" },
      },
    );
    if (migrationResult.modifiedCount > 0) {
      authLogger.log(
        `[BetterAuth 1.7 Migration] Backfilled issuer="local:credential" on ${migrationResult.modifiedCount} legacy credential account(s).`,
      );
    }
  } catch (migrationErr) {
    authLogger.error(
      `[BetterAuth 1.7 Migration] Failed to backfill account issuer: ${migrationErr instanceof Error ? migrationErr.message : String(migrationErr)}`,
    );
  }

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
      additionalFields: {
        role: {
          type: "string",
          defaultValue: "user",
          input: false,
          required: false,
        },
        primerNombre: {
          type: "string",
          defaultValue: "",
          input: true,
          required: false,
        },
        segundoNombre: {
          type: "string",
          defaultValue: "",
          input: true,
          required: false,
        },
        primerApellido: {
          type: "string",
          defaultValue: "",
          input: true,
          required: false,
        },
        segundoApellido: {
          type: "string",
          defaultValue: "",
          input: true,
          required: false,
        },
        country: {
          type: "string",
          defaultValue: "",
          input: true,
          required: false,
        },
        birthDate: {
          type: "string",
          defaultValue: "",
          input: true,
          required: false,
        },
      },
    },

    session: {
      expiresIn: 60 * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },

    advanced: {
      useSecureCookies: false,
      defaultCookieAttributes: { sameSite: "lax" },
    },

    trustedOrigins:
      process.env.NODE_ENV === "production"
        ? [
            "https://bskmt.com",
            "https://www.bskmt.com",
            "https://dash.bskmt.com",
          ]
        : [
            "https://bskmt.com",
            "https://dash.bskmt.com",
            "http://localhost:3000",
            "http://localhost:4321",
            "http://localhost:4322",
          ],

    disabledPaths: ["/sign-in/email"],
    databaseHooks: createBetterAuthHooks(mongoDb, authLogger),
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
