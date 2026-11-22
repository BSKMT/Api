import { Logger } from "@nestjs/common";
import { Db, ObjectId } from "mongodb";
import type {
  BetterAuthApiErrorCtor,
  BetterAuthSession,
  BetterAuthUser,
} from "./better-auth.types";
import { maskEmail } from "../common/utils/log-redact.util";
import {
  parseUserPersonalData,
  validateAntiAccountTakeover,
  syncExistingMongooseUser,
  insertNewMongooseUser,
  cleanupOrphanBetterAuthUser,
} from "./better-auth-user-sync.helper";
import type { BirdContactService } from "../bird/bird-contact.service";

const STAFF_PORTAL_ROLES = new Set(["admin", "superadmin", "gestor"]);

async function isStaffOrSubroleUser(
  mongoDb: Db,
  betterAuthUserId: string,
): Promise<boolean> {
  if (!betterAuthUserId) return false;
  const userDoc = await mongoDb
    .collection("users")
    .findOne(
      { betterAuthId: betterAuthUserId },
      { projection: { role: 1, subrol: 1 } },
    );
  if (!userDoc) return false;
  const role = typeof userDoc["role"] === "string" ? userDoc["role"] : "";
  const subrol: unknown = userDoc["subrol"];
  return (
    STAFF_PORTAL_ROLES.has(role) ||
    (typeof subrol === "string" && subrol.trim().length > 0)
  );
}

export const ALLOWED_USER_EMAIL_DOMAINS = new Set([
  "outlook.com",
  "hotmail.com",
  "live.com",
  "gmail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "yahoo.com",
  "yahoo.es",
]);

async function syncProvisionedUserToBird(
  birdContactService: BirdContactService | null | undefined,
  params: {
    email: string;
    primerNombre: string;
    primerApellido: string;
    externalId: string;
    role: string;
    subrol: string | null;
    membershipLevel: string | null;
    membershipExpired: boolean;
  },
  authLogger: Logger,
): Promise<void> {
  if (!birdContactService) return;
  try {
    await birdContactService.syncContact(params);
  } catch (birdErr) {
    authLogger.warn(
      `[databaseHooks] Bird CRM sync warning para ${maskEmail(params.email)}: ${birdErr instanceof Error ? birdErr.message : String(birdErr)}`,
    );
  }
}

async function provisionMongooseUserFromBetterAuth(
  mongoDb: Db,
  user: BetterAuthUser,
  authLogger: Logger,
  APIErrorCtor?: BetterAuthApiErrorCtor,
): Promise<{
  insertedId: ObjectId | null;
  parsed: ReturnType<typeof parseUserPersonalData>;
  role: string;
  subrol: string | null;
  membershipLevel: string | null;
  membershipExpired: boolean;
}> {
  const parsed = parseUserPersonalData(user);
  const existingUser = await mongoDb.collection("users").findOne({
    $or: [{ email: user.email.toLowerCase() }, { betterAuthId: user.id }],
  });

  if (!existingUser) {
    const insertedId = await insertNewMongooseUser(mongoDb, user, parsed);
    return {
      insertedId,
      parsed,
      role: "user",
      subrol: null,
      membershipLevel: null,
      membershipExpired: false,
    };
  }

  validateAntiAccountTakeover(existingUser, user, authLogger, APIErrorCtor);
  await syncExistingMongooseUser(mongoDb, existingUser, user, parsed);
  return {
    insertedId: existingUser._id,
    parsed,
    role: (existingUser["role"] as string) || "user",
    subrol: (existingUser["subrol"] as string) || null,
    membershipLevel: (existingUser["membershipLevel"] as string) || null,
    membershipExpired: Boolean(existingUser["membershipExpired"]),
  };
}

export function createBetterAuthHooks(
  mongoDb: Db,
  authLogger: Logger,
  getBirdContactService?: () => BirdContactService | null,
  APIErrorCtor?: BetterAuthApiErrorCtor,
) {
  const ALLOWED_DOMAINS = ALLOWED_USER_EMAIL_DOMAINS;

  return {
    user: {
      create: {
        before: (user: BetterAuthUser): { data: BetterAuthUser } => {
          const email = (user.email ?? "").toLowerCase();
          const domain = email.split("@")[1] ?? "";
          if (!ALLOWED_DOMAINS.has(domain)) {
            const message =
              "El dominio del correo no esta permitido. Usa Microsoft (outlook, hotmail, live), Google (gmail), Apple (icloud, me, mac) o Yahoo.";
            if (APIErrorCtor) {
              throw new APIErrorCtor("BAD_REQUEST", { message });
            }
            throw new Error(message);
          }
          return { data: user };
        },
        after: async (user: BetterAuthUser): Promise<void> => {
          try {
            const provisioned = await provisionMongooseUserFromBetterAuth(
              mongoDb,
              user,
              authLogger,
              APIErrorCtor,
            );
            await syncProvisionedUserToBird(
              getBirdContactService?.(),
              {
                email: user.email,
                primerNombre: provisioned.parsed.primerNombre,
                primerApellido: provisioned.parsed.primerApellido,
                externalId: provisioned.insertedId
                  ? String(provisioned.insertedId)
                  : user.id,
                role: provisioned.role,
                subrol: provisioned.subrol,
                membershipLevel: provisioned.membershipLevel,
                membershipExpired: provisioned.membershipExpired,
              },
              authLogger,
            );
          } catch (err) {
            authLogger.error(
              `[databaseHooks] Failed to insert Mongoose user for betterAuthId=${user.id} email=${maskEmail(user.email)}: ${err instanceof Error ? err.message : String(err)}`,
            );
            await cleanupOrphanBetterAuthUser(mongoDb, user.id, authLogger);
            if (APIErrorCtor && err instanceof APIErrorCtor) {
              throw err;
            }
            const message =
              "No se pudo crear el usuario. Intenta de nuevo en unos minutos.";
            if (APIErrorCtor) {
              throw new APIErrorCtor("INTERNAL_SERVER_ERROR", { message });
            }
            throw new Error(message);
          }
        },
      },
      update: {
        after: async (user: BetterAuthUser): Promise<void> => {
          try {
            const updateFields: Record<string, unknown> = {
              emailVerified: user.emailVerified ?? false,
              updatedAt: new Date(),
            };
            if (typeof user.email === "string" && user.email.trim()) {
              updateFields["email"] = user.email.trim().toLowerCase();
            }
            await mongoDb
              .collection("users")
              .updateOne({ betterAuthId: user.id }, { $set: updateFields });

            try {
              const birdContactService = getBirdContactService?.();
              if (birdContactService) {
                await birdContactService.syncContact({
                  email: user.email,
                  externalId: user.id,
                });
              }
            } catch (birdErr) {
              authLogger.warn(
                `[databaseHooks] Bird CRM sync warning on update para ${maskEmail(user.email)}: ${birdErr instanceof Error ? birdErr.message : String(birdErr)}`,
              );
            }
          } catch (err) {
            authLogger.error(
              "[databaseHooks] Failed to sync user update:",
              err,
            );
          }
        },
      },
    },
    session: {
      create: {
        before: async (
          session: BetterAuthSession,
          ctx?: { path?: string },
        ): Promise<{ data: BetterAuthSession } | false> => {
          const path = (ctx?.path ?? "").toLowerCase();
          const staffUser = await isStaffOrSubroleUser(mongoDb, session.userId);
          if (staffUser) {
            if (
              path.includes("/sign-in/social") ||
              path.includes("/callback") ||
              path.includes("/passkey/verify-authentication")
            ) {
              authLogger.warn(
                `[databaseHooks] Bloqueando bypass 4FA en ${path} para userId=${session.userId}: abortando creación de sesión.`,
              );
              return false;
            }
            return { data: { ...session, otpPending: true, authPortal: "standard" } };
          }
          // Fail-closed: toda sesión nacida vía /sign-in/email requiere completar login-otp
          // desde el mismo momento de inserción en MongoDB (elimina ventana de carrera).
          if (path === "/sign-in/email" || path.startsWith("/sign-in/email/")) {
            return { data: { ...session, otpPending: true, authPortal: "standard" } };
          }
          return { data: { ...session, authPortal: "standard" } };
        },
      },
    },
  };
}
