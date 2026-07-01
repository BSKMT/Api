import { MongoClient } from "mongodb";
import type { EmailService } from "../zoho-mail/email.service";

const mongoUrl = process.env.MONGODB_URI ?? "mongodb://localhost:27017/bskmt";

const mongoClient = new MongoClient(mongoUrl);
const mongoDb = mongoClient.db();

let authInstance: Awaited<ReturnType<typeof initAuth>> | null = null;
let authPromise: Promise<Awaited<ReturnType<typeof initAuth>>> | null = null;
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

async function initAuth() {
  const { betterAuth } = await import("better-auth");
  const { mongodbAdapter } = await import("better-auth/adapters/mongodb");

  const landingPageUrl =
    injectedLandingPageUrl ??
    process.env.LANDING_PAGE_URL ??
    "http://localhost:4321";

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
      requireEmailVerification: true,

      sendResetPassword: async ({ user, token }) => {
        const resetUrl = `${landingPageUrl}/restaurar-contrasena?token=${token}`;

        if (injectedEmailService) {
          const ok = await injectedEmailService.sendPasswordResetEmail({
            to: user.email,
            name: (user as { name?: string }).name ?? user.email,
            resetUrl,
          });
          if (!ok) {
            console.warn(
              `[Password Reset] No se pudo enviar el correo a ${user.email} (Zoho no configurado o fallo)`,
            );
            console.log(`[Password Reset] Fallback link: ${resetUrl}`);
          }
        } else {
          console.log(
            `[Password Reset] Reset link for ${user.email}: ${resetUrl}`,
          );
        }
      },

      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 3600,
    },

    emailVerification: {
      sendVerificationEmail: async ({ user, token }) => {
        const verificationUrl = `${landingPageUrl}/verificar-correo?token=${token}`;

        if (injectedEmailService) {
          const ok = await injectedEmailService.sendVerificationEmail({
            to: user.email,
            name: (user as { name?: string }).name ?? user.email,
            verificationUrl,
          });
          if (!ok) {
            console.warn(
              `[Email Verification] No se pudo enviar el correo a ${user.email} (Zoho no configurado o fallo)`,
            );
            console.log(
              `[Email Verification] Fallback link: ${verificationUrl}`,
            );
          }
        } else {
          console.log(
            `[Email Verification] Verification link for ${user.email}: ${verificationUrl}`,
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
       */
      useSecureCookies: false,
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
            try {
              const primerNombre =
                (user as { primerNombre?: string }).primerNombre ?? "";
              const segundoNombre =
                (user as { segundoNombre?: string }).segundoNombre ?? "";
              const primerApellido =
                (user as { primerApellido?: string }).primerApellido ?? "";
              const segundoApellido =
                (user as { segundoApellido?: string }).segundoApellido ?? "";
              const country = (user as { country?: string }).country ?? "";
              const birthDate =
                (user as { birthDate?: string }).birthDate ?? "";

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

export type InferSession<T> = T extends { $Infer: { Session: infer S } }
  ? S
  : never;
export type Session = InferSession<Awaited<ReturnType<typeof initAuth>>>;
