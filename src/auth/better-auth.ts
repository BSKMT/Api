import { MongoClient } from "mongodb";
import type { EmailService } from "../zoho-mail/email.service";

/* ------------------------------------------------------------------ *
 * Dynamic import of ESM-only `better-auth` submodules.
 *
 * `better-auth` is published as `"type": "module"` (every deep import is
 * a `.mjs` file). The project is compiled to CommonJS by `nest build`,
 * so any top-level `import` of `better-auth/*` becomes a `require()`
 * call at runtime — and requiring an ES Module throws `ERR_REQUIRE_ESM`.
 *
 * To stay CommonJS-compatible we lazily load the required functions via
 * `await import(...)` and cache the resolved module shape so the
 * dynamic import only happens once per cold start.
 * ------------------------------------------------------------------ */

/** Typed shape of `better-auth` core module. */
interface BetterAuthCoreModule {
  betterAuth: (options: Record<string, unknown>) => AuthInstance;
}
/** Typed shape of `better-auth/adapters/mongodb`. */
interface BetterAuthMongoModule {
  mongodbAdapter: (db: unknown, opts: Record<string, unknown>) => unknown;
}

/* ------------------------------------------------------------------ *
 * Explicit type definitions
 *
 * better-auth exports extremely deep generic types (Auth<Options>,
 * InferPluginTypes, InferAPI, …). The TypeScript language server in
 * some editor environments cannot resolve those generics within the
 * ESLint type-checked rules, reporting them as "error" types which
 * cascade into dozens of `no-unsafe-*` violations.
 *
 * To keep the code type-safe and lint-clean without suppressing any
 * rule, we define concrete interfaces that mirror the runtime shapes
 * we actually use. The imported functions are re-typed through
 * `unknown` (double-cast) so every call site is fully typed.
 * ------------------------------------------------------------------ */

/** Base user fields returned by better-auth (mirrors `userSchema`). */
export interface BetterAuthUser {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string;
  image?: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** Additional fields declared in `user.additionalFields`. */
  role?: string;
  primerNombre?: string;
  segundoNombre?: string;
  primerApellido?: string;
  segundoApellido?: string;
  country?: string;
  birthDate?: string;
}

/** Session document shape (mirrors `sessionSchema`). */
export interface BetterAuthSession {
  id: string;
  token: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  userId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** Result of `auth.api.getSession()` — `null` when no session found. */
export interface BetterAuthSessionData {
  session: BetterAuthSession;
  user: BetterAuthUser;
}

/** Headers accepted by better-auth API methods (Web `Headers` or plain record). */
type AuthHeaders = Headers | Record<string, string | string[] | undefined>;

/** Minimal subset of the `Auth` instance we consume across the app. */
export interface AuthInstance {
  handler: (request: Request) => Promise<Response>;
  api: {
    getSession: (params: {
      headers: AuthHeaders;
    }) => Promise<BetterAuthSessionData | null>;
    changePassword: (params: {
      body: { currentPassword: string; newPassword: string };
      headers: AuthHeaders;
    }) => Promise<unknown>;
    signInEmail: (params: {
      body: { email: string; password: string; rememberMe?: boolean };
      asResponse?: boolean;
      headers?: AuthHeaders;
    }) => Promise<Response>;
  };
  options: unknown;
  $ERROR_CODES: Record<string, string>;
  $Infer: {
    Session: BetterAuthSessionData;
  };
}

/** Re-typed better-auth factory — avoids deep generic inference. */
type BetterAuthFn = (options: Record<string, unknown>) => AuthInstance;
type MongodbAdapterFn = (db: unknown, opts: Record<string, unknown>) => unknown;
interface BetterAuthDeps {
  betterAuth: BetterAuthFn;
  mongodbAdapter: MongodbAdapterFn;
}

let depsPromise: Promise<BetterAuthDeps> | null = null;

/**
 * Lazily resolve and cache the ESM-only `better-auth` factory and the
 * MongoDB adapter. Subsequent calls return the same promise so the
 * dynamic import only fires once.
 */
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

/**
 * Returns the shared MongoClient Db instance (singleton).
 * Use this instead of creating ad-hoc MongoClient instances to avoid
 * connection pool exhaustion in serverless environments.
 */
export function getMongoDb() {
  return mongoDb;
}

let authInstance: AuthInstance | null = null;
let authPromise: Promise<AuthInstance> | null = null;
let injectedEmailService: EmailService | null = null;
let injectedLandingPageUrl: string | null = null;

/**
 * Inyecta el EmailService (Zoho) para que los callbacks de correo de Better Auth
 * (envío de verificación y restablecimiento de contraseña) puedan enviar correos
 * reales a través de Zoho Mail.
 *
 * Debe llamarse desde `main.ts` despues de que el contenedor de NestJS este listo,
 * y **antes** de que se inicialice la instancia de Better Auth (es decir, antes
 * de la primera llamada a `getAuth()`).
 */
export function setAuthDependencies(
  emailService: EmailService,
  landingPageUrl: string,
): void {
  injectedEmailService = emailService;
  injectedLandingPageUrl = landingPageUrl;
  if (authInstance) {
    console.warn(
      "[better-auth] setAuthDependencies se llamo despues de la inicializacion. " +
        "Los callbacks de correo ya fueron configurados sin EmailService.",
    );
  }
}

async function initAuth(): Promise<AuthInstance> {
  const { betterAuth, mongodbAdapter } = await loadBetterAuthDeps();

  const landingPageUrl =
    injectedLandingPageUrl ??
    process.env.LANDING_PAGE_URL ??
    (process.env.NODE_ENV === "production"
      ? "https://bskmt.com"
      : "http://localhost:4321");

  return betterAuth({
    appName: "BSK Motorcycle Team",
    database: mongodbAdapter(mongoDb, {
      client: mongoClient,
    }),

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

      sendResetPassword: async ({
        user,
        token,
      }: {
        user: BetterAuthUser;
        token: string;
      }): Promise<void> => {
        const resetUrl = `${landingPageUrl}/restaurar-contrasena#token=${token}`;

        if (injectedEmailService) {
          const ok = await injectedEmailService.sendPasswordResetEmail({
            to: user.email,
            name: user.name ?? user.email,
            resetUrl,
          });
          if (!ok) {
            console.warn(
              `[Password Reset] No se pudo enviar el correo a ${user.email} (Zoho no configurado o fallo)`,
            );
          }
        } else {
          console.warn(
            `[Password Reset] Email service not configured — reset email NOT sent to ${user.email}`,
          );
        }
      },

      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 3600,
    },

    emailVerification: {
      sendVerificationEmail: async ({
        user,
        token,
      }: {
        user: BetterAuthUser;
        token: string;
      }): Promise<void> => {
        const verificationUrl = `${landingPageUrl}/verificar-correo#token=${token}`;

        if (injectedEmailService) {
          const ok = await injectedEmailService.sendVerificationEmail({
            to: user.email,
            name: user.name ?? user.email,
            verificationUrl,
          });
          if (!ok) {
            console.warn(
              `[Email Verification] No se pudo enviar el correo a ${user.email} (Zoho no configurado o fallo)`,
            );
          }
        } else {
          console.warn(
            `[Email Verification] Email service not configured — verification email NOT sent to ${user.email}`,
          );
        }
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
      expiresIn: 7 * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60,
      },
    },

    advanced: {
      /**
       * useSecureCookies is false because the Astro proxy (BFF pattern)
       * handles the `Secure` flag on cookies using `isSecure` (based on
       * the request protocol). Setting this to `true` causes better-auth
       * to prepend `__Secure-` to cookie names, which breaks all cookie
       * lookups in the landing page (middleware, AuthButton, me.ts).
       *
       * SECURITY: The API must NEVER be called directly by browsers.
       * All browser traffic must go through the Astro BFF which adds
       * the Secure flag. If the API were exposed directly, cookies
       * would lack the Secure attribute and could leak over HTTP.
       */
      useSecureCookies: false,
      /**
       * SameSite=strict prevents the session cookie from being sent on
       * any cross-site request, effectively blocking CSRF attacks on
       * all cookie-authenticated endpoints (including JSON APIs that
       * are not covered by Astro's checkOrigin).
       */
      defaultCookieAttributes: {
        sameSite: "strict",
      },
    },

    trustedOrigins:
      process.env.NODE_ENV === "production"
        ? ["https://bskmt.com"]
        : [
            "https://bskmt.com",
            "http://localhost:4321",
            "http://localhost:4322",
          ],

    databaseHooks: {
      user: {
        create: {
          before: (user: BetterAuthUser): BetterAuthUser => {
            const ALLOWED_DOMAINS = [
              "outlook.com",
              "hotmail.com",
              "live.com",
              "gmail.com",
              "icloud.com",
              "me.com",
              "mac.com",
              "yahoo.com",
              "yahoo.es",
            ];
            const email = (user.email ?? "").toLowerCase();
            const domain = email.split("@")[1] ?? "";
            if (!ALLOWED_DOMAINS.includes(domain)) {
              throw new Error(
                "El dominio del correo no esta permitido. Usa Microsoft (outlook, hotmail, live), Google (gmail), Apple (icloud, me, mac) o Yahoo.",
              );
            }
            return user;
          },
          after: async (user: BetterAuthUser): Promise<void> => {
            try {
              const primerNombre = user.primerNombre ?? "";
              const segundoNombre = user.segundoNombre ?? "";
              const primerApellido = user.primerApellido ?? "";
              const segundoApellido = user.segundoApellido ?? "";
              const country = user.country ?? "";
              const birthDate = user.birthDate ?? "";

              const tieneDatosPersonales = primerNombre || primerApellido;

              await mongoDb.collection("users").insertOne({
                email: user.email.toLowerCase(),
                betterAuthId: user.id,
                role: "user",
                profileCompleted: false,
                emailVerified: user.emailVerified ?? false,
                legalConsentAccepted: false,
                isActive: true,
                completedSections: tieneDatosPersonales
                  ? ["datos-personales"]
                  : [],
                profile: tieneDatosPersonales
                  ? {
                      "datos-personales": {
                        primerNombre,
                        segundoNombre,
                        primerApellido,
                        segundoApellido,
                        nacionalidad: country,
                        fechaNacimiento: birthDate,
                      },
                    }
                  : {},
                installmentsPaid: 0,
                installmentsTotal: 12,
                renewalInstallmentsPaid: 0,
                membershipExpired: false,
                createdAt: new Date(),
                updatedAt: new Date(),
              });
            } catch (err) {
              console.error("[databaseHooks] Failed to insert user:", err);
            }
          },
        },
        update: {
          after: async (user: BetterAuthUser): Promise<void> => {
            try {
              await mongoDb.collection("users").updateOne(
                { betterAuthId: user.id },
                {
                  $set: {
                    emailVerified: user.emailVerified ?? false,
                    updatedAt: new Date(),
                  },
                },
              );
            } catch (err) {
              console.error(
                "[databaseHooks] Failed to sync emailVerified:",
                err,
              );
            }
          },
        },
      },
    },
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

export type Session = BetterAuthSessionData;
