import { betterAuth } from "better-auth";
import { MongoClient } from "mongodb";
import { mongodbAdapter } from "better-auth/adapters/mongodb";

/**
 * Better Auth instance for BSK Motorcycle Team.
 *
 * Replaces the previous Passport + JWT + bcrypt + CSRF custom auth stack.
 * Better Auth manages: user accounts, sessions, email/password auth,
 * email verification, password reset, and session cookies.
 */
const mongoUrl = process.env.MONGODB_URI ?? "mongodb://localhost:27017/bskmt";

const mongoClient = new MongoClient(mongoUrl);
const mongoDb = mongoClient.db();

export const auth = betterAuth({
  database: mongodbAdapter(mongoDb, {
    client: mongoClient,
  }),

  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  secret: process.env.BETTER_AUTH_SECRET ?? process.env.JWT_SECRET ?? "fallback-secret-change-me",

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    autoSignIn: true,
    requireEmailVerification: false,

    sendResetPassword: async ({ user, url }, _request) => {
      console.log(
        `[Password Reset] Reset link for ${user.email}: ${url}`,
      );
    },

    revokeSessionsOnPasswordReset: true,
    resetPasswordTokenExpiresIn: 3600,
  },

  emailVerification: {
    sendVerificationEmail: async ({ user, url }, _request) => {
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
          /**
           * After Better Auth creates a user, insert a corresponding
           * document into the Mongoose `users` collection with all
           * business-data fields (profile, membership, role, etc.).
           */
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

export type Session = typeof auth.$Infer.Session;