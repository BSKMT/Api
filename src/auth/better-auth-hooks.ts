import { Logger } from "@nestjs/common";
import { Db, ObjectId } from "mongodb";
import type { BetterAuthUser } from "./better-auth.types";
import { maskEmail } from "../common/utils/log-redact.util";
import {
  parseUserPersonalData,
  validateAntiAccountTakeover,
  syncExistingMongooseUser,
  insertNewMongooseUser,
  cleanupOrphanBetterAuthUser,
} from "./better-auth-user-sync.helper";
import type { BirdContactService } from "../bird/bird-contact.service";

export function createBetterAuthHooks(
  mongoDb: Db,
  authLogger: Logger,
  getBirdContactService?: () => BirdContactService | null,
) {
  const ALLOWED_DOMAINS = new Set([
    "outlook.com",
    "hotmail.com",
    "live.com",
    "gmail.com",
    "icloud.com",
    "me.com",
    "mac.com",
    "yahoo.com",
    "yahoo.es",
    "bskmt.com",
  ]);

  return {
    user: {
      create: {
        before: (user: BetterAuthUser): BetterAuthUser => {
          const email = (user.email ?? "").toLowerCase();
          const domain = email.split("@")[1] ?? "";
          if (!ALLOWED_DOMAINS.has(domain)) {
            throw new Error(
              "El dominio del correo no esta permitido. Usa Microsoft (outlook, hotmail, live), Google (gmail), Apple (icloud, me, mac) o Yahoo.",
            );
          }
          return user;
        },
        after: async (user: BetterAuthUser): Promise<void> => {
          let insertedId: ObjectId | null = null;
          let role = "user";
          let subrol: string | null = null;
          let membershipLevel: string | null = null;
          let membershipExpired = false;

          try {
            const parsed = parseUserPersonalData(user);
            const existingUser = await mongoDb.collection("users").findOne({
              $or: [
                { email: user.email.toLowerCase() },
                { betterAuthId: user.id },
              ],
            });

            if (existingUser) {
              validateAntiAccountTakeover(existingUser, user, authLogger);
              await syncExistingMongooseUser(
                mongoDb,
                existingUser,
                user,
                parsed,
              );
              insertedId = existingUser._id;
              role = (existingUser["role"] as string) || "user";
              subrol = (existingUser["subrol"] as string) || null;
              membershipLevel =
                (existingUser["membershipLevel"] as string) || null;
              membershipExpired = Boolean(existingUser["membershipExpired"]);
            } else {
              insertedId = await insertNewMongooseUser(mongoDb, user, parsed);
            }

            // Sincronizar contacto en Bird CRM en la audiencia correspondiente
            try {
              const birdContactService = getBirdContactService?.();
              if (birdContactService) {
                await birdContactService.syncContact({
                  email: user.email,
                  primerNombre: parsed.primerNombre,
                  primerApellido: parsed.primerApellido,
                  externalId: insertedId ? String(insertedId) : user.id,
                  role,
                  subrol,
                  membershipLevel,
                  membershipExpired,
                });
              }
            } catch (birdErr) {
              authLogger.warn(
                `[databaseHooks] Bird CRM sync warning para ${maskEmail(user.email)}: ${birdErr instanceof Error ? birdErr.message : String(birdErr)}`,
              );
            }
          } catch (err) {
            authLogger.error(
              `[databaseHooks] Failed to insert Mongoose user for betterAuthId=${user.id} email=${maskEmail(user.email)}: ${err instanceof Error ? err.message : String(err)}`,
            );
            await cleanupOrphanBetterAuthUser(mongoDb, user.id, authLogger);
            throw new Error(
              "No se pudo crear el usuario. Intenta de nuevo en unos minutos.",
            );
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
              "[databaseHooks] Failed to sync emailVerified:",
              err,
            );
          }
        },
      },
    },
  };
}
