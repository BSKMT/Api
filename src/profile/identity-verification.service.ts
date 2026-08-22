import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { User, UserDocument } from "../users/schemas/user.schema";
import {
  VerifikService,
  type VerifikIdentityRecord,
  type VerifikDocumentType,
} from "../verifik/verifik.service";
import { maskDocument } from "../common/utils/log-redact.util";

/** Per-check outcome surfaced to the UI so the user knows what to fix. */
export type CheckOutcome =
  | "match"
  | "mismatch"
  | "auto_filled"
  | "not_provided"
  | "not_comparable"
  | "not_applicable";

export interface IdentityCheckResult {
  names: CheckOutcome;
  birthDate: CheckOutcome;
  gender: CheckOutcome;
  documentStatus: CheckOutcome;
}

export interface IdentityVerificationStatus {
  identityVerified: boolean;
  verifiedAt: string | null;
  document: {
    /** Raw value as stored in the user's profile (Spanish label). */
    type: string;
    number: string;
    /** Verifik type when the document is verifiable, else null. */
    verifikType: VerifikDocumentType | null;
    /** True when the Verifik route needs the document issue date. */
    requiresExpeditionDate: boolean;
  };
  verification: {
    documentType: string;
    documentNumber: string;
    fullName: string;
    dateOfBirth: string | null;
    gender: string | null;
    documentStatus: string | null;
    verifiedAt: string;
  } | null;
}

export interface IdentityVerifyResult {
  verified: boolean;
  message: string;
  checks: IdentityCheckResult | null;
  /** Profile fields auto-filled from the official record (success only). */
  autoFilledFields: string[];
  /** Official data echo — only returned on success (anti-enumeration). */
  officialData: {
    fullName: string;
    dateOfBirth: string | null;
    gender: string | null;
    documentStatus: string | null;
  } | null;
}

/** Profile document-type labels → Verifik document types. */
const DOCUMENT_TYPE_MAP: Array<{
  label: RegExp;
  verifik: VerifikDocumentType;
}> = [
  { label: /^CEDULA DE CIUDADANIA$/, verifik: "CC" },
  { label: /^CC$/, verifik: "CC" },
  { label: /^CEDULA DE EXTRANJERIA$/, verifik: "CE" },
  { label: /^CE$/, verifik: "CE" },
  { label: /^PPT$/, verifik: "PPT" },
  { label: /PROTECCION TEMPORAL/, verifik: "PPT" },
  { label: /^PEP$/, verifik: "PEP" },
  { label: /PERMANENCIA/, verifik: "PEP" },
];

/** Digit-length validation per Verifik route requirements. */
const DOCUMENT_NUMBER_PATTERN: Record<VerifikDocumentType, RegExp> = {
  CC: /^\d{5,10}$/,
  CE: /^\d{4,10}$/,
  PPT: /^\d{3,10}$/,
  PEP: /^\d{15}$/,
};

/** Foreigner routes require the document issue date. */
const REQUIRES_EXPEDITION_DATE: Record<VerifikDocumentType, boolean> = {
  CC: false,
  CE: true,
  PPT: true,
  PEP: true,
};

/** Similarity threshold for the Dice bigram comparison of full names. */
const NAME_SIMILARITY_THRESHOLD = 0.75;

/**
 * IdentityVerificationService — KYC flow that confirms the person
 * behind a BSK account is real by matching their declared data
 * against official Colombian sources via Verifik:
 *
 *  - CC  → Registraduría Nacional (premium route: names + DOB + gender
 *          + alive status, no issue date needed).
 *  - CE / PPT / PEP → Migración Colombia (names + immigration status,
 *          requires the document issue date).
 *
 * Comparison policy (identity is confirmed only when every applicable
 * check passes):
 *  - names: normalized fuzzy match (Dice bigrams or token subset).
 *  - birth date / gender (CC): exact match when the user declared
 *    them; auto-filled from the official record when empty.
 *  - document status (foreigners): must be VIGENTE.
 *  - isAlive === false or an expired permit always fails.
 *
 * Security (OWASP 2025):
 *  - A01 Broken Access Control: the verified flag is written only
 *    here, server-side; `datos-personales` edits reset it when the
 *    document identity changes.
 *  - A06 Insecure Design / anti-enumeration: failed checks never
 *    echo the official record — only which field mismatched — so a
 *    logged-in attacker cannot harvest third-party registry data.
 *  - A07 Authentication Failures: per-user attempt throttling on top
 *    of the NestJS @Throttle layer, because every lookup costs
 *    Verifik credits (financial DoS protection).
 *  - A09 Logging: document numbers are masked in every log line.
 *  - A04 Cryptographic Failures: the Verifik bearer token never
 *    leaves the server; the client only ever talks to this API.
 */
@Injectable()
export class IdentityVerificationService {
  private readonly logger = new Logger(IdentityVerificationService.name);

  /** In-memory per-user attempt ledger (3 attempts / 10 minutes). */
  private readonly ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
  private readonly ATTEMPT_MAX = 3;
  private readonly attempts = new Map<string, number[]>();

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly verifikService: VerifikService,
  ) {}

  // ── Status ───────────────────────────────────────────────────────────

  /** Returns the current verification state for the UI. */
  async getStatus(userId: string): Promise<IdentityVerificationStatus> {
    const user = await this.userModel.findById(userId).lean();
    if (!user) {
      throw new BadRequestException("Usuario no encontrado");
    }

    const personal = user.profile?.["datos-personales"] ?? {};
    const rawType =
      typeof personal.tipoDocumento === "string" ? personal.tipoDocumento : "";
    const rawNumber =
      typeof personal.numeroDocumento === "string"
        ? personal.numeroDocumento
        : "";
    const verifikType = mapDocumentType(rawType);

    const record = user.identityVerification ?? null;

    return {
      identityVerified: user.identityVerified ?? false,
      verifiedAt: user.identityVerifiedAt
        ? user.identityVerifiedAt.toISOString()
        : null,
      document: {
        type: rawType,
        number: rawNumber,
        verifikType,
        requiresExpeditionDate: verifikType
          ? REQUIRES_EXPEDITION_DATE[verifikType]
          : false,
      },
      verification: record
        ? {
            documentType: record.documentType,
            documentNumber: record.documentNumber,
            fullName: record.fullName,
            dateOfBirth: record.dateOfBirth,
            gender: record.gender,
            documentStatus: record.documentStatus,
            verifiedAt: record.verifiedAt.toISOString(),
          }
        : null,
    };
  }

  // ── Verification ─────────────────────────────────────────────────────

  /**
   * Runs the KYC verification for the document stored in the user's
   * `datos-personales` section. See the class docblock for the
   * comparison policy.
   *
   * @param userId          Authenticated user id.
   * @param expeditionDate  Optional ISO date (YYYY-MM-DD) required for
   *                        CE / PPT / PEP documents.
   */
  async verifyIdentity(
    userId: string,
    expeditionDate?: string,
  ): Promise<IdentityVerifyResult> {
    if (!this.verifikService.isConfigured()) {
      throw new ServiceUnavailableException(
        "La verificacion de identidad no esta disponible en este momento.",
      );
    }

    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new BadRequestException("Usuario no encontrado");
    }

    if (user.identityVerified) {
      throw new ConflictException(
        "Tu identidad ya esta verificada. Si cambiaste tu documento, actualiza tu perfil primero.",
      );
    }

    const personal = user.profile?.["datos-personales"] ?? {};
    const rawType =
      typeof personal.tipoDocumento === "string" ? personal.tipoDocumento : "";
    const rawNumber =
      typeof personal.numeroDocumento === "string"
        ? personal.numeroDocumento
        : "";

    const verifikType = mapDocumentType(rawType);
    if (!verifikType) {
      throw new BadRequestException(
        "El tipo de documento registrado no admite verificacion automatica. Contacta al equipo BSK.",
      );
    }

    const documentNumber = rawNumber.replace(/\D/g, "");
    if (!DOCUMENT_NUMBER_PATTERN[verifikType].test(documentNumber)) {
      throw new BadRequestException(
        verifikType === "PEP"
          ? "El numero de PEP debe tener exactamente 15 digitos."
          : "El numero de documento no tiene un formato valido. Corrigelo en tu perfil e intenta de nuevo.",
      );
    }

    // Foreigner routes need the document issue date.
    let verifikExpeditionDate: string | null = null;
    if (REQUIRES_EXPEDITION_DATE[verifikType]) {
      verifikExpeditionDate = this.toVerifikDate(expeditionDate);
      if (!verifikExpeditionDate) {
        throw new BadRequestException(
          "Debes ingresar la fecha de expedicion de tu documento (DD/MM/AAAA).",
        );
      }
    }

    this.enforceAttemptThrottle(userId);

    const lookup = await this.callVerifik(
      verifikType,
      documentNumber,
      verifikExpeditionDate,
    );

    this.recordAttempt(userId);

    if (!lookup.ok) {
      if (lookup.reason === "not_found") {
        throw new BadRequestException(lookup.message);
      }
      if (lookup.reason === "invalid_input") {
        throw new BadRequestException(lookup.message);
      }
      this.logger.warn(
        `Verifik lookup failed (${lookup.reason}) for user ${userId} doc ${maskDocument(documentNumber)}`,
      );
      throw new ServiceUnavailableException(lookup.message);
    }

    const record = lookup.record;
    const checks = this.evaluateChecks(personal, verifikType, record);

    const failed = this.collectFailures(checks, record, verifikType);
    if (failed.length > 0) {
      // Anti-enumeration: never echo the official record on failure.
      this.logger.warn(
        `Identity mismatch for user ${userId} doc ${maskDocument(documentNumber)}: ${failed.join(", ")}`,
      );
      return {
        verified: false,
        message: this.buildFailureMessage(failed),
        checks,
        autoFilledFields: [],
        officialData: null,
      };
    }

    // Success: persist the verified identity and auto-fill blanks.
    const autoFilledFields = this.applyAutoFill(user, personal, record);

    user.identityVerified = true;
    user.identityVerifiedAt = new Date();
    user.identityVerification = {
      documentType: verifikType,
      documentNumber: documentNumber,
      fullName:
        record.fullName ??
        [record.firstName, record.lastName].filter(Boolean).join(" "),
      firstName: record.firstName,
      lastName: record.lastName,
      dateOfBirth: record.dateOfBirth
        ? this.toIsoDate(record.dateOfBirth)
        : null,
      gender: record.gender,
      documentStatus: record.status,
      expirationDate: record.expirationDate,
      verifikId: record.verifikId,
      verifiedAt: user.identityVerifiedAt,
    };
    await user.save();

    this.logger.log(
      `Identity verified for user ${userId} doc ${maskDocument(documentNumber)} (${verifikType})`,
    );

    return {
      verified: true,
      message: "Tu identidad fue verificada correctamente.",
      checks,
      autoFilledFields,
      officialData: {
        fullName: user.identityVerification.fullName,
        dateOfBirth: user.identityVerification.dateOfBirth,
        gender: record.gender,
        documentStatus: record.status,
      },
    };
  }

  // ── Check evaluation ─────────────────────────────────────────────────

  /**
   * Compares the user's declared data against the official record.
   * `personal` is the raw `datos-personales` profile section.
   */
  private evaluateChecks(
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

    const names: CheckOutcome =
      normalizeName(declaredFirst).length > 0 &&
      namesMatch(declaredFirst, officialName)
        ? "match"
        : "mismatch";

    // Birth date / gender are only returned by the CC premium route.
    let birthDate: CheckOutcome = "not_applicable";
    let gender: CheckOutcome = "not_applicable";

    if (verifikType === "CC") {
      const declaredDob = asString(personal.fechaNacimiento);

      if (!record.dateOfBirth) {
        birthDate = "not_provided";
      } else if (!declaredDob) {
        birthDate = "auto_filled";
      } else {
        birthDate =
          this.toIsoDate(declaredDob) === this.toIsoDate(record.dateOfBirth)
            ? "match"
            : "mismatch";
      }

      const declaredGender = asString(personal.genero);
      if (!record.gender) {
        gender = "not_provided";
      } else if (!declaredGender) {
        gender = "auto_filled";
      } else {
        const mapped = mapOfficialGender(record.gender);
        if (mapped === null) {
          gender = "not_comparable";
        } else {
          const normalizedDeclared = normalizeName(declaredGender);
          gender =
            normalizedDeclared === mapped
              ? "match"
              : normalizedDeclared === "NO BINARIO" ||
                  normalizedDeclared === "PREFIERO NO DECIR"
                ? "not_comparable"
                : "mismatch";
        }
      }
    }

    // Immigration status only applies to foreigner documents.
    let documentStatus: CheckOutcome = "not_applicable";
    if (verifikType !== "CC") {
      documentStatus = record.status
        ? record.status.trim().toUpperCase() === "VIGENTE"
          ? "match"
          : "mismatch"
        : "not_provided";
    }

    return { names, birthDate, gender, documentStatus };
  }

  /** Hard failures that block verification. */
  private collectFailures(
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

  private buildFailureMessage(failures: string[]): string {
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
      parts.push(
        "tu documento no se encuentra vigente ante Migracion Colombia",
      );
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
  private applyAutoFill(
    user: UserDocument,
    personal: Record<string, unknown>,
    record: VerifikIdentityRecord,
  ): string[] {
    const filled: string[] = [];
    const section = { ...personal };

    if (!asString(section.fechaNacimiento) && record.dateOfBirth) {
      const iso = this.toIsoDate(record.dateOfBirth);
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

  // ── Verifik dispatch ─────────────────────────────────────────────────

  private async callVerifik(
    verifikType: VerifikDocumentType,
    documentNumber: string,
    expeditionDate: string | null,
  ): Promise<Awaited<ReturnType<VerifikService["verifyCedulaPremium"]>>> {
    switch (verifikType) {
      case "CC":
        return this.verifikService.verifyCedulaPremium(documentNumber);
      case "CE":
        return this.verifikService.verifyCe(
          documentNumber,
          expeditionDate ?? "",
        );
      case "PPT":
        return this.verifikService.verifyPpt(
          documentNumber,
          expeditionDate ?? "",
        );
      case "PEP":
        return this.verifikService.verifyPep(
          documentNumber,
          expeditionDate ?? "",
        );
    }
  }

  // ── Attempt throttling ───────────────────────────────────────────────

  private enforceAttemptThrottle(userId: string): void {
    const now = Date.now();
    const cutoff = now - this.ATTEMPT_WINDOW_MS;
    const timestamps = (this.attempts.get(userId) ?? []).filter(
      (t) => t > cutoff,
    );
    if (timestamps.length >= this.ATTEMPT_MAX) {
      this.logger.warn(
        `Identity-verification throttle: user ${userId} exceeded ${this.ATTEMPT_MAX} attempts in 10 min`,
      );
      throw new HttpException(
        "Has superado el limite de intentos de verificacion. Espera 10 minutos e intenta de nuevo.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private recordAttempt(userId: string): void {
    const now = Date.now();
    const cutoff = now - this.ATTEMPT_WINDOW_MS;
    const timestamps = (this.attempts.get(userId) ?? []).filter(
      (t) => t > cutoff,
    );
    timestamps.push(now);
    this.attempts.set(userId, timestamps);
  }

  // ── Date helpers ─────────────────────────────────────────────────────

  /** Converts a client ISO date (YYYY-MM-DD) into Verifik DD/MM/YYYY. */
  private toVerifikDate(iso: string | undefined): string | null {
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
  private toIsoDate(value: string): string | null {
    const trimmed = value.trim();
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const latin = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(trimmed);
    if (latin) return `${latin[3]}-${latin[2]}-${latin[1]}`;
    return null;
  }
}

// ── Pure helpers ────────────────────────────────────────────────────────

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Maps a profile document label to a Verifik document type. */
export function mapDocumentType(raw: string): VerifikDocumentType | null {
  if (!raw) return null;
  const normalized = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
  for (const entry of DOCUMENT_TYPE_MAP) {
    if (entry.label.test(normalized)) return entry.verifik;
  }
  return null;
}

/** Uppercase, accent-free, single-spaced comparison form of a name. */
function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Official gender → normalized comparable form (HOMBRE/MUJER). */
function mapOfficialGender(gender: string): string | null {
  const normalized = normalizeName(gender);
  if (normalized === "HOMBRE" || normalized === "M") return "MASCULINO";
  if (normalized === "MUJER" || normalized === "F") return "FEMENINO";
  return null;
}

/** Official gender → the profile's select label. */
function mapOfficialGenderToLabel(gender: string): string | null {
  const mapped = mapOfficialGender(gender);
  return mapped === "MASCULINO"
    ? "Masculino"
    : mapped === "FEMENINO"
      ? "Femenino"
      : null;
}

/**
 * Fuzzy name match: exact after normalization, Dice bigram
 * similarity, or bidirectional token subset (handles users who
 * omit second names).
 */
function namesMatch(declared: string, official: string): boolean {
  const a = normalizeName(declared);
  const b = normalizeName(official);
  if (!a || !b) return false;
  if (a === b) return true;

  const tokensA = a.split(" ");
  const tokensB = b.split(" ");
  const setB = new Set(tokensB);
  const setA = new Set(tokensA);

  // Subset either way (at least 2 tokens declared to avoid trivial
  // single-token matches).
  if (tokensA.length >= 2 && tokensA.every((t) => setB.has(t))) return true;
  if (tokensB.length >= 2 && tokensB.every((t) => setA.has(t))) return true;

  return diceCoefficient(a, b) >= NAME_SIMILARITY_THRESHOLD;
}

/** Sørensen–Dice coefficient over character bigrams. */
function diceCoefficient(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const bigrams = new Map<string, number>();
  for (let i = 0; i < b.length - 1; i++) {
    const gram = b.slice(i, i + 2);
    bigrams.set(gram, (bigrams.get(gram) ?? 0) + 1);
  }

  let intersections = 0;
  for (let i = 0; i < a.length - 1; i++) {
    const gram = a.slice(i, i + 2);
    const count = bigrams.get(gram) ?? 0;
    if (count > 0) {
      bigrams.set(gram, count - 1);
      intersections++;
    }
  }

  return (2 * intersections) / (a.length - 1 + b.length - 1);
}
