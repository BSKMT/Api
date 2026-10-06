import { Logger } from "@nestjs/common";
import { Db, ObjectId } from "mongodb";
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
              // Prevenir Account Takeover (OWASP A01/A07):
              // Si ya tiene un betterAuthId asignado diferente al nuevo ID, no permitir sobreescritura.
              if (
                existingUser["betterAuthId"] &&
                existingUser["betterAuthId"] !== user.id
              ) {
                authLogger.warn(
                  `[databaseHooks] Intento de colisión o secuestro de cuenta para email=${maskEmail(user.email)}. Existente betterAuthId=${existingUser["betterAuthId"]}, entrante=${user.id}`,
                );
                throw new Error(
                  "Este correo ya está asociado a otra cuenta activa. Inicia sesión con tus credenciales originales.",
                );
              }

              // Si la cuenta existente no tenía betterAuthId pero el email entrante no está verificado:
              if (!existingUser["betterAuthId"] && !user.emailVerified) {
                authLogger.warn(
                  `[databaseHooks] Rechazando vinculación de cuenta huérfana con email no verificado=${maskEmail(user.email)}`,
                );
                throw new Error(
                  "Debes verificar tu correo antes de poder vincular tu cuenta existente.",
                );
              }

              const existingProfile =
                existingUser &&
                typeof existingUser["profile"] === "object" &&
                existingUser["profile"] !== null
                  ? (existingUser["profile"] as Record<string, unknown>)
                  : null;
              const hasExistingDatosPersonales = Boolean(
                existingProfile && existingProfile["datos-personales"],
              );

              await mongoDb.collection("users").updateOne(
                { _id: existingUser._id },
                {
                  $set: {
                    betterAuthId: user.id,
                    emailVerified:
                      user.emailVerified ??
                      Boolean(existingUser["emailVerified"]),
                    updatedAt: new Date(),
                    ...(tieneDatosPersonales && !hasExistingDatosPersonales
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
              const userFilters: (string | ObjectId)[] = [user.id];
              if (user.id && ObjectId.isValid(user.id)) {
                userFilters.push(new ObjectId(user.id));
              }
              const idFilters: Record<string, unknown>[] = [{ id: user.id }];
              if (user.id && ObjectId.isValid(user.id)) {
                idFilters.push({ _id: new ObjectId(user.id) });
              }

              await mongoDb.collection("account").deleteMany({
                userId: { $in: userFilters },
              });
              await mongoDb.collection("session").deleteMany({
                userId: { $in: userFilters },
              });
              await mongoDb.collection("user").deleteOne({ $or: idFilters });
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
