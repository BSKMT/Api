import type { UserDocument } from "../users/schemas/user.schema";
import type {
  VerifikIdentityRecord,
  VerifikDocumentType,
} from "../verifik/verifik.service";
import type {
  CheckOutcome,
  IdentityCheckResult,
} from "./identity-verification.types";
import {
  asString,
  normalizeName,
  mapOfficialGender,
  mapOfficialGenderToLabel,
  namesMatch,
} from "./identity-verification-matcher";

/** Converts a client ISO date (YYYY-MM-DD) into Verifik DD/MM/YYYY. */
export function toVerifikDate(iso: string | undefined): string | null {
  if (!iso) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(`${iso}T00:00:00Z`);
  if (
    Number.isNaN(date.getTime()) ||
    Number(y) < 1900 ||
    date.getTime() > Date.now() + 24 * 60 * 60 * 1000
  ) {
    return null;
  }
  return `${d}/${m}/${y}`;
}

/**
 * Normalizes the various date shapes Verifik returns
 * (YYYY-MM-DD, ISO timestamps, DD/MM/YYYY) into YYYY-MM-DD.
 */
export function toIsoDate(value: string): string | null {
  const trimmed = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const latin = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(trimmed);
  if (latin) return `${latin[3]}-${latin[2]}-${latin[1]}`;
  return null;
}

export function evaluateNameCheck(
  declared: string,
  official: string,
): CheckOutcome {
  if (normalizeName(declared).length > 0 && namesMatch(declared, official)) {
    return "match";
  }
  return "mismatch";
}

export function evaluateBirthDateCheck(
  declaredDob: string | null,
  officialDob: string | null,
): CheckOutcome {
  if (!officialDob) return "not_provided";
  if (!declaredDob) return "auto_filled";
  return toIsoDate(declaredDob) === toIsoDate(officialDob)
    ? "match"
    : "mismatch";
}

export function evaluateGenderCheck(
  declaredGender: string | null,
  officialGender: string | null,
): CheckOutcome {
  if (!officialGender) return "not_provided";
  if (!declaredGender) return "auto_filled";
  const mapped = mapOfficialGender(officialGender);
  if (mapped === null) return "not_comparable";
  const normalizedDeclared = normalizeName(declaredGender);
  if (normalizedDeclared === mapped) return "match";
  if (
    normalizedDeclared === "NO BINARIO" ||
    normalizedDeclared === "PREFIERO NO DECIR"
  ) {
    return "not_comparable";
  }
  return "mismatch";
}

export function evaluateDocumentStatusCheck(
  status: string | null,
): CheckOutcome {
  if (!status) return "not_provided";
  return status.trim().toUpperCase() === "VIGENTE" ? "match" : "mismatch";
}

/**
 * Compares the user's declared data against the official record.
 * `personal` is the raw `datos-personales` profile section.
 */
export function evaluateChecks(
  personal: Record<string, unknown>,
  verifikType: VerifikDocumentType,
  record: VerifikIdentityRecord,
): IdentityCheckResult {
  const declaredFirst = [
    asString(personal.primerNombre),
    asString(personal.segundoNombre),
    asString(personal.primerApellido),
    asString(personal.segundoApellido),
  ]
    .filter((part): part is string => Boolean(part))
    .join(" ");

  const officialName =
    record.fullName ??
    [record.firstName, record.lastName].filter(Boolean).join(" ") ??
    record.arrayName.join(" ");

  const names = evaluateNameCheck(declaredFirst, officialName);
  const birthDate =
    verifikType === "CC"
      ? evaluateBirthDateCheck(
          asString(personal.fechaNacimiento),
          record.dateOfBirth,
        )
      : "not_applicable";
  const gender =
    verifikType === "CC"
      ? evaluateGenderCheck(asString(personal.genero), record.gender)
      : "not_applicable";
  const documentStatus =
    verifikType !== "CC"
      ? evaluateDocumentStatusCheck(record.status)
      : "not_applicable";

  return { names, birthDate, gender, documentStatus };
}

/** Hard failures that block verification. */
export function collectFailures(
  checks: IdentityCheckResult,
  record: VerifikIdentityRecord,
  verifikType: VerifikDocumentType,
): string[] {
  const failures: string[] = [];

  if (checks.names === "mismatch") failures.push("names");
  if (checks.birthDate === "mismatch") failures.push("birthDate");
  if (checks.gender === "mismatch") failures.push("gender");
  if (checks.documentStatus === "mismatch") failures.push("documentStatus");
  if (verifikType === "CC" && record.isAlive === false) {
    failures.push("notAlive");
  }

  return failures;
}

export function buildFailureMessage(failures: string[]): string {
  const parts: string[] = [];
  if (failures.includes("names")) {
    parts.push("los nombres no coinciden con el registro oficial");
  }
  if (failures.includes("birthDate")) {
    parts.push("la fecha de nacimiento no coincide con el registro oficial");
  }
  if (failures.includes("gender")) {
    parts.push("el genero no coincide con el registro oficial");
  }
  if (failures.includes("documentStatus")) {
    parts.push("tu documento no se encuentra vigente ante Migracion Colombia");
  }
  if (failures.includes("notAlive")) {
    parts.push("el registro oficial no permite completar la verificacion");
  }
  return `No pudimos confirmar tu identidad porque ${parts.join(" y ")}. Corrige los datos en tu perfil e intenta de nuevo.`;
}

/**
 * Fills empty `datos-personales` fields from the official record
 * and returns the list of auto-filled field names. Only blanks are
 * completed — values the user already declared are never
 * overwritten (they had to match to get here).
 */
export function applyAutoFill(
  user: UserDocument,
  personal: Record<string, unknown>,
  record: VerifikIdentityRecord,
): string[] {
  const filled: string[] = [];
  const section = { ...personal };

  if (!asString(section.fechaNacimiento) && record.dateOfBirth) {
    const iso = toIsoDate(record.dateOfBirth);
    if (iso) {
      section.fechaNacimiento = iso;
      filled.push("fechaNacimiento");
    }
  }

  if (!asString(section.genero) && record.gender) {
    const mapped = mapOfficialGenderToLabel(record.gender);
    if (mapped) {
      section.genero = mapped;
      filled.push("genero");
    }
  }

  if (filled.length > 0) {
    const profile = user.profile ?? {};
    profile["datos-personales"] = section;
    user.profile = profile;
    user.markModified("profile");
  }

  return filled;
}
