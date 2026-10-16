import { Logger } from "@nestjs/common";
import { Db, ObjectId, WithId, Document } from "mongodb";
import type { BetterAuthUser } from "./better-auth.types";
import { maskEmail } from "../common/utils/log-redact.util";

export interface ParsedUserData {
  primerNombre: string;
  segundoNombre: string;
  primerApellido: string;
  segundoApellido: string;
  country: string;
  birthDate: string;
  tieneDatosPersonales: boolean;
}

export function parseUserPersonalData(user: BetterAuthUser): ParsedUserData {
  let primerNombre = user.primerNombre ?? "";
  const segundoNombre = user.segundoNombre ?? "";
  let primerApellido = user.primerApellido ?? "";
  const segundoApellido = user.segundoApellido ?? "";
  const country = user.country ?? "";
  const birthDate = user.birthDate ?? "";

  if (!primerNombre && user.name) {
    const parts = user.name.trim().split(/\s+/);
    if (parts.length > 0) {
      primerNombre = parts[0];
      if (parts.length > 1) {
        primerApellido = parts.slice(1).join(" ");
      }
    }
  }

  return {
    primerNombre,
    segundoNombre,
    primerApellido,
    segundoApellido,
    country,
    birthDate,
    tieneDatosPersonales: Boolean(primerNombre || primerApellido),
  };
}

export function validateAntiAccountTakeover(
  existingUser: WithId<Document>,
  user: BetterAuthUser,
  authLogger: Logger,
): void {
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

  if (!existingUser["betterAuthId"] && !user.emailVerified) {
    authLogger.warn(
      `[databaseHooks] Rechazando vinculación de cuenta huérfana con email no verificado=${maskEmail(user.email)}`,
    );
    throw new Error(
      "Debes verificar tu correo antes de poder vincular tu cuenta existente.",
    );
  }
}

export async function syncExistingMongooseUser(
  mongoDb: Db,
  existingUser: WithId<Document>,
  user: BetterAuthUser,
  parsed: ParsedUserData,
): Promise<void> {
  const existingProfile =
    typeof existingUser["profile"] === "object" &&
    existingUser["profile"] !== null
      ? (existingUser["profile"] as Record<string, unknown>)
      : null;
  const hasExistingDatosPersonales = Boolean(
    existingProfile?.["datos-personales"],
  );

  await mongoDb.collection("users").updateOne(
    { _id: existingUser._id },
    {
      $set: {
        betterAuthId: user.id,
        emailVerified:
          user.emailVerified ?? Boolean(existingUser["emailVerified"]),
        updatedAt: new Date(),
        ...(parsed.tieneDatosPersonales && !hasExistingDatosPersonales
          ? {
              "profile.datos-personales": {
                primerNombre: parsed.primerNombre,
                segundoNombre: parsed.segundoNombre,
                primerApellido: parsed.primerApellido,
                segundoApellido: parsed.segundoApellido,
                nacionalidad: parsed.country,
                fechaNacimiento: parsed.birthDate,
              },
            }
          : {}),
      },
    },
  );
}

export async function insertNewMongooseUser(
  mongoDb: Db,
  user: BetterAuthUser,
  parsed: ParsedUserData,
): Promise<void> {
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
    completedSections: parsed.tieneDatosPersonales ? ["datos-personales"] : [],
    profile: parsed.tieneDatosPersonales
      ? {
          "datos-personales": {
            primerNombre: parsed.primerNombre,
            segundoNombre: parsed.segundoNombre,
            primerApellido: parsed.primerApellido,
            segundoApellido: parsed.segundoApellido,
            nacionalidad: parsed.country,
            fechaNacimiento: parsed.birthDate,
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

export async function cleanupOrphanBetterAuthUser(
  mongoDb: Db,
  userId: string,
  authLogger: Logger,
): Promise<void> {
  try {
    const userFilters: (string | ObjectId)[] = [userId];
    if (userId && ObjectId.isValid(userId)) {
      userFilters.push(new ObjectId(userId));
    }
    const idFilters: Record<string, unknown>[] = [{ id: userId }];
    if (userId && ObjectId.isValid(userId)) {
      idFilters.push({ _id: new ObjectId(userId) });
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
      `[databaseHooks] Failed to cleanup orphan Better Auth user ${userId}: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`,
    );
  }
}
