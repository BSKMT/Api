import { MongoClient } from "mongodb";

const mongoUrl = process.env.MONGODB_URI ?? "mongodb://localhost:27017/bskmt";

const mongoClient = new MongoClient(mongoUrl);
const mongoDb = mongoClient.db();

let authInstance: Awaited<ReturnType<typeof initAuth>> | null = null;
let authPromise: Promise<Awaited<ReturnType<typeof initAuth>>> | null = null;

async function initAuth() {
  const { betterAuth } = await import("better-auth");
  const { mongodbAdapter } = await import("better-auth/adapters/mongodb");

  return betterAuth({
    database: mongodbAdapter(mongoDb, {
      client: mongoClient,
    }),

    baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
    secret:
      process.env.BETTER_AUTH_SECRET ??
      process.env.JWT_SECRET ??
      "fallback-secret-change-me",

    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      autoSignIn: true,
      requireEmailVerification: false,

      sendResetPassword: async ({ user, url }) => {
        console.log(`[Password Reset] Reset link for ${user.email}: ${url}`);
      },

      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 3600,
    },

    emailVerification: {
      sendVerificationEmail: async ({ user, url }) => {
        console.log(
          `[Email Verification] Verification link for ${user.email}: ${url}`,
        );
      },

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
      },
    },

    session: {
      expiresIn: 7 * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60,
      },
    },

    advanced: {
      crossSubDomainCookies: {
        enabled: true,
        domain: process.env.COOKIE_DOMAIN ?? "bskmt.com",
      },
      useSecureCookies: process.env.COOKIE_SECURE !== "false",
    },

    trustedOrigins: [
      "https://bskmt.com",
      "http://localhost:4321",
      "http://localhost:4322",
    ],

    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await mongoDb.collection("users").insertOne({
              email: user.email.toLowerCase(),
              betterAuthId: user.id,
              role: "user",
              profileCompleted: false,
              emailVerified: user.emailVerified ?? false,
              legalConsentAccepted: false,
              isActive: true,
              completedSections: [],
              profile: {},
              installmentsPaid: 0,
              installmentsTotal: 12,
              renewalInstallmentsPaid: 0,
              membershipExpired: false,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
          },
        },
      },
    },
  });
}

export function getAuth(): Promise<Awaited<ReturnType<typeof initAuth>>> {
  if (authInstance) return Promise.resolve(authInstance);
  if (!authPromise) {
    authPromise = initAuth().then((instance) => {
      authInstance = instance;
      return instance;
    });
  }
  return authPromise;
}

export type InferSession<T> = T extends { $Infer: { Session: infer S } } ? S : never;
export type Session = InferSession<Awaited<ReturnType<typeof initAuth>>>;
