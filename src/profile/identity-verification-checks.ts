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

/**
 * Converts a client date (`YYYY-MM-DD`, `DD/MM/YYYY`, or `D/M/YYYY`)
 * into Verifik's required `DD/MM/YYYY` format.
 */
export function toVerifikDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  let y: string;
  let m: string;
  let d: string;

  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  const latinMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (isoMatch) {
    [, y, m, d] = isoMatch;
  } else if (latinMatch) {
    [, d, m, y] = latinMatch;
  } else {
    return null;
  }

  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  const padM = m.padStart(2, "0");
  const padD = d.padStart(2, "0");
  const date = new Date(`${y}-${padM}-${padD}T00:00:00Z`);
  if (
    Number.isNaN(date.getTime()) ||
    year < 1900 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day ||
    date.getTime() > Date.now() + 24 * 60 * 60 * 1000
  ) {
    return null;
  }
  return `${padD}/${padM}/${y}`;
}

/**
 * Normalizes the various date shapes Verifik returns
 * (YYYY-MM-DD, ISO timestamps, DD/MM/YYYY) into YYYY-MM-DD.
 */
export function toIsoDate(value: string): string | null {
  const trimmed = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const latin = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(trimmed);
  if (latin) {
    return `${latin[3]}-${latin[2].padStart(2, "0")}-${latin[1].padStart(2, "0")}`;
  }
  return null;
}

export function evaluateNameCheck(
  declared: string,
  official: string,
): CheckOutcome {
  if (!declared || normalizeName(declared).length === 0) {
    return "mismatch";
  }
  if (namesMatch(declared, official)) {
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
  const upper = status.trim().toUpperCase();
  return upper === "VIGENTE" || upper === "ACTIVO" || upper === "ACTIVA"
    ? "match"
    : "mismatch";
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
