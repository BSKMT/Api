import { Logger } from "@nestjs/common";
import { Db } from "mongodb";
import type { BetterAuthUser } from "./better-auth.types";
import { maskEmail } from "../common/utils/log-redact.util";
import {
  parseUserPersonalData,
  validateAntiAccountTakeover,
  syncExistingMongooseUser,
  insertNewMongooseUser,
  cleanupOrphanBetterAuthUser,
} from "./better-auth-user-sync.helper";

export function createBetterAuthHooks(mongoDb: Db, authLogger: Logger) {
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
            } else {
              await insertNewMongooseUser(mongoDb, user, parsed);
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
