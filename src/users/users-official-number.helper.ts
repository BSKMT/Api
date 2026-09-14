import { randomInt } from "node:crypto";
import { Model } from "mongoose";
import { UserDocument } from "./schemas/user.schema";

export function getColombiaDate(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const colombiaMs = now.getTime() + (offset + 300) * 60000;
  return new Date(colombiaMs).toISOString().split("T")[0];
}

/**
 * Generates a 10-digit official identification number according to the BSK specification:
 * - First 3 digits: always "901"
 * - Middle 3 digits: "411" for regular users (usuarios) or "412" for active members (miembros)
 * - Last 4 digits: random 4-digit unique number (0000-9999)
 * Format: 901411xxxx (user) / 901412xxxx (member)
 */
export async function generateOfficialNumber(
  userModel: Model<UserDocument>,
  isMember: boolean,
  fixedSuffix?: string,
): Promise<string> {
  const prefix = isMember ? "901412" : "901411";

  if (fixedSuffix && /^\d{4}$/.test(fixedSuffix)) {
    const candidate = `${prefix}${fixedSuffix}`;
    const exists = await userModel
      .findOne({ "profile.membresia-ecosistema.numeroMiembro": candidate })
      .lean();
    if (!exists) return candidate;
  }

  for (let attempt = 0; attempt < 50; attempt++) {
    const randomSuffix = String(randomInt(0, 10000)).padStart(4, "0");
    const candidate = `${prefix}${randomSuffix}`;
    const exists = await userModel
      .findOne({ "profile.membresia-ecosistema.numeroMiembro": candidate })
      .lean();
    if (!exists) return candidate;
  }

  const fallbackSuffix = String(Date.now() % 10000).padStart(4, "0");
  return `${prefix}${fallbackSuffix}`;
}

export function extractPhoneFromContacto(
  contacto: Record<string, unknown> | undefined,
): string | null {
  if (!contacto) return null;
  const tel =
    contacto["telefono"] ??
    contacto["celular"] ??
    contacto["whatsapp"] ??
    contacto["phone"];
  if (typeof tel === "string" && tel.trim()) return tel.trim();
  return null;
}

export function syncPhoneIfChanged(
  user: UserDocument,
  sanitizedData: Record<string, unknown>,
): void {
  const oldPhone = extractPhoneFromContacto(user.profile?.["contacto"]);
  const newPhone = extractPhoneFromContacto(sanitizedData);

  if (newPhone && newPhone !== oldPhone) {
    user.phone = newPhone;
    user.phoneVerified = false;
    user.phoneVerifiedAt = null;
    user.pendingPhone = null;
  } else if (newPhone && newPhone === oldPhone && user.phone !== newPhone) {
    user.phone = newPhone;
  }
}

export function resetIdentityIfDocumentChanged(
  user: UserDocument,
  sanitizedData: Record<string, unknown>,
): void {
  const personal = user.profile?.["datos-personales"] ?? {};
  const oldType =
    typeof personal.tipoDocumento === "string" ? personal.tipoDocumento : "";
  const oldNumber =
    typeof personal.numeroDocumento === "string"
      ? personal.numeroDocumento
      : "";
  const newType =
    typeof sanitizedData.tipoDocumento === "string"
      ? sanitizedData.tipoDocumento
      : "";
  const newNumber =
    typeof sanitizedData.numeroDocumento === "string"
      ? sanitizedData.numeroDocumento
      : "";

  const normalizeNumber = (n: string): string => n.replace(/\D/g, "");
  const changed =
    (newType && newType !== oldType) ||
    (newNumber && normalizeNumber(newNumber) !== normalizeNumber(oldNumber));

  if (changed) {
    user.identityVerified = false;
    user.identityVerifiedAt = null;
    user.identityVerification = null;
  }
}
