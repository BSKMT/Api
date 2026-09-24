import { Logger } from "@nestjs/common";
import { Db } from "mongodb";
import type { BetterAuthUser } from "./better-auth.types";
import { maskEmail } from "../common/utils/log-redact.util";

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
            let primerNombre = user.primerNombre ?? "";
            const segundoNombre = user.segundoNombre ?? "";
            let primerApellido = user.primerApellido ?? "";
            const segundoApellido = user.segundoApellido ?? "";
            const country = user.country ?? "";
            const birthDate = user.birthDate ?? "";

            // If user signed up via Google, parse name into primerNombre / primerApellido
            if (!primerNombre && user.name) {
              const parts = user.name.trim().split(/\s+/);
              if (parts.length > 0) {
                primerNombre = parts[0];
                if (parts.length > 1) {
                  primerApellido = parts.slice(1).join(" ");
                }
              }
            }

            const tieneDatosPersonales = Boolean(
              primerNombre || primerApellido,
            );

            const existingUser = await mongoDb.collection("users").findOne({
              $or: [
                { email: user.email.toLowerCase() },
                { betterAuthId: user.id },
              ],
            });

            if (existingUser) {
              await mongoDb.collection("users").updateOne(
                { _id: existingUser._id },
                {
                  $set: {
                    betterAuthId: user.id,
                    emailVerified:
                      user.emailVerified ?? existingUser.emailVerified ?? false,
                    updatedAt: new Date(),
                    ...(tieneDatosPersonales &&
                    (!existingUser.profile ||
                      !existingUser.profile["datos-personales"])
                      ? {
                          "profile.datos-personales": {
                            primerNombre,
                            segundoNombre,
                            primerApellido,
                            segundoApellido,
                            nacionalidad: country,
                            fechaNacimiento: birthDate,
                          },
                        }
                      : {}),
                  },
                },
              );
            } else {
              await mongoDb.collection("users").insertOne({
                email: user.email.toLowerCase(),
                betterAuthId: user.id,
                role: "user",
                profileCompleted: false,
                emailVerified: user.emailVerified ?? false,
                legalConsentAccepted: false,
                isActive: true,
                phone: null,
                phoneVerified: false,
                phoneVerifiedAt: null,
                pendingPhone: null,
                pendingEmail: null,
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
            }
          } catch (err) {
            authLogger.error(
              `[databaseHooks] Failed to insert Mongoose user for betterAuthId=${user.id} email=${maskEmail(user.email)}: ${err instanceof Error ? err.message : String(err)}`,
            );
            try {
              await mongoDb.collection("account").deleteMany({
                userId: user.id,
              });
              await mongoDb.collection("session").deleteMany({
                userId: user.id,
              });
              await mongoDb.collection("user").deleteOne({ id: user.id });
            } catch (cleanupErr) {
              authLogger.error(
                `[databaseHooks] Failed to cleanup orphan Better Auth user ${user.id}: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`,
              );
            }
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
