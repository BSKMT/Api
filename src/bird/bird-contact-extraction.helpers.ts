import { Types } from "mongoose";
import type { Model } from "mongoose";
import type { UserDocument } from "../users/schemas/user.schema";

export function normalizePhoneNumberHelper(
  rawPhone?: string | null,
): string | null {
  if (!rawPhone || typeof rawPhone !== "string") {
    return null;
  }

  const cleaned = rawPhone.replace(/[\s\-().]/g, "").trim();
  if (!cleaned) return null;

  if (cleaned.startsWith("+")) {
    const digitsOnly = cleaned.slice(1);
    if (/^\d{10,15}$/.test(digitsOnly)) {
      return cleaned;
    }
    return null;
  }

  if (cleaned.startsWith("57") && cleaned.length === 12) {
    return `+${cleaned}`;
  }

  if (cleaned.startsWith("3") && cleaned.length === 10) {
    return `+57${cleaned}`;
  }

  if (/^\d{10,15}$/.test(cleaned)) {
    return `+${cleaned}`;
  }

  return null;
}

export async function resolveUserDocHelper(
  userModel: Model<UserDocument>,
  userOrId: string | UserDocument | Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  if (typeof userOrId === "string") {
    const found = Types.ObjectId.isValid(userOrId)
      ? await userModel.findById(userOrId).lean()
      : await userModel.findOne({ email: userOrId.toLowerCase() }).lean();
    return found ? (found as unknown as Record<string, unknown>) : null;
  }
  if (userOrId && typeof userOrId === "object") {
    return (
      typeof (userOrId as UserDocument).toObject === "function"
        ? (userOrId as UserDocument).toObject()
        : userOrId
    ) as Record<string, unknown>;
  }
  return null;
}

export function extractNamesHelper(
  datosPersonales: Record<string, unknown>,
  userDoc: Record<string, unknown>,
  identityVerification: Record<string, unknown>,
): { primerNombre: string | null; primerApellido: string | null } {
  const primerNombre =
    (typeof datosPersonales["primerNombre"] === "string"
      ? datosPersonales["primerNombre"]
      : "") ||
    (typeof userDoc["primerNombre"] === "string"
      ? userDoc["primerNombre"]
      : "");
  const segundoNombre =
    typeof datosPersonales["segundoNombre"] === "string"
      ? datosPersonales["segundoNombre"]
      : "";
  const primerApellido =
    (typeof datosPersonales["primerApellido"] === "string"
      ? datosPersonales["primerApellido"]
      : "") ||
    (typeof userDoc["primerApellido"] === "string"
      ? userDoc["primerApellido"]
      : "");
  const segundoApellido =
    typeof datosPersonales["segundoApellido"] === "string"
      ? datosPersonales["segundoApellido"]
      : "";

  const fullFirstName = [primerNombre, segundoNombre].filter(Boolean).join(" ");
  const fullLastName = [primerApellido, segundoApellido]
    .filter(Boolean)
    .join(" ");

  const rawName = userDoc["name"];
  const fallbackName = typeof rawName === "string" ? rawName.trim() : "";
  const fallbackFirstName = fallbackName ? fallbackName.split(" ")[0] : "";

  const ivFullName =
    typeof identityVerification["fullName"] === "string"
      ? identityVerification["fullName"].trim()
      : "";

  let ivFirstName = "";
  if (typeof identityVerification["firstName"] === "string") {
    ivFirstName = identityVerification["firstName"].trim();
  } else if (ivFullName) {
    ivFirstName = ivFullName.split(" ")[0] || "";
  }

  let ivLastName = "";
  if (typeof identityVerification["lastName"] === "string") {
    ivLastName = identityVerification["lastName"].trim();
  } else if (ivFullName) {
    ivLastName = ivFullName.split(" ").slice(1).join(" ");
  }

  const primerNombreVal: string | null =
    fullFirstName || fallbackFirstName || ivFirstName || null;
  const primerApellidoVal: string | null = fullLastName || ivLastName || null;

  return { primerNombre: primerNombreVal, primerApellido: primerApellidoVal };
}

export function extractPhoneHelper(
  userDoc: Record<string, unknown>,
  contacto: Record<string, unknown>,
): string | null {
  if (typeof userDoc["phone"] === "string" && userDoc["phone"]) {
    return userDoc["phone"];
  }
  if (typeof contacto["celular"] === "string" && contacto["celular"]) {
    return contacto["celular"];
  }
  if (typeof userDoc["pendingPhone"] === "string" && userDoc["pendingPhone"]) {
    return userDoc["pendingPhone"];
  }
  return null;
}

export function extractExternalIdHelper(
  userDoc: Record<string, unknown>,
): string | null {
  const rawId = userDoc["_id"];
  if (typeof rawId === "string" && rawId) {
    return rawId;
  }
  if (
    rawId &&
    typeof (rawId as { toString?: () => string }).toString === "function"
  ) {
    return (rawId as { toString(): string }).toString();
  }
  return null;
}

export function extractDocumentNumberHelper(
  datosPersonales: Record<string, unknown>,
  identityVerification: Record<string, unknown>,
): string | null {
  const rawDocNumber =
    identityVerification["documentNumber"] ??
    datosPersonales["numeroDocumento"];
  if (typeof rawDocNumber === "string" && rawDocNumber.trim()) {
    return rawDocNumber.trim();
  }
  if (typeof rawDocNumber === "number") {
    return String(rawDocNumber);
  }
  return null;
}
