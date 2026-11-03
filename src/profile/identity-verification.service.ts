import {
  Injectable,
  Logger,
  BadRequestException,
  ServiceUnavailableException,
  Optional,
} from "@nestjs/common";
import { BirdContactService } from "../bird/bird-contact.service";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import {
  User,
  UserDocument,
  REQUIRED_PROFILE_SECTIONS,
} from "../users/schemas/user.schema";
import {
  VerifikService,
  VerifikIdentityRecord,
  VerifikDocumentType,
} from "../verifik/verifik.service";
import { maskDocument } from "../common/utils/log-redact.util";
import {
  REQUIRES_EXPEDITION_DATE,
  mapDocumentType,
  parseOfficialNames,
  mapVerifikTypeToLabel,
  mapOfficialGenderToLabel,
} from "./identity-verification-matcher";
import type {
  IdentityVerificationStatus,
  IdentityVerifyResult,
} from "./identity-verification.types";
import {
  toIsoDate,
  evaluateChecks,
  collectFailures,
  buildFailureMessage,
} from "./identity-verification-checks";
import {
  IdentityAttemptThrottle,
  extractAndValidateDocument,
  handleLookupFailure,
  callVerifikService,
} from "./identity-verification.helpers";
import { KvCacheService } from "../kv/kv-cache.service";
import { isSectionValid } from "../users/users-profile.helper";
import { VerifyIdentityDto } from "./dto/verify-identity.dto";

export type {
  CheckOutcome,
  IdentityCheckResult,
  IdentityVerificationStatus,
  IdentityVerifyResult,
} from "./identity-verification.types";
export { mapDocumentType } from "./identity-verification-matcher";

function applyNameFields(
  updated: Record<string, unknown>,
  filled: string[],
  parsedNames: ReturnType<typeof parseOfficialNames>,
): void {
  updated.primerNombre = parsedNames.primerNombre;
  filled.push("primerNombre");

  updated.segundoNombre = parsedNames.segundoNombre || "";
  if (parsedNames.segundoNombre) {
    filled.push("segundoNombre");
  }

  updated.primerApellido = parsedNames.primerApellido;
  filled.push("primerApellido");

  updated.segundoApellido = parsedNames.segundoApellido || "";
  if (parsedNames.segundoApellido) {
    filled.push("segundoApellido");
  }
}

function applyOfficialPersonalData(
  personal: Record<string, unknown>,
  record: VerifikIdentityRecord,
  verifikType: VerifikDocumentType,
  documentNumber: string,
): {
  updated: Record<string, unknown>;
  filled: string[];
  parsedNames: ReturnType<typeof parseOfficialNames>;
} {
  const updated = { ...personal };
  const filled: string[] = [];
  const parsedNames = parseOfficialNames(record);

  updated.tipoDocumento = mapVerifikTypeToLabel(verifikType);
  updated.numeroDocumento = documentNumber;

  applyNameFields(updated, filled, parsedNames);

  const isoDob = record.dateOfBirth ? toIsoDate(record.dateOfBirth) : null;
  if (isoDob) {
    updated.fechaNacimiento = isoDob;
    filled.push("fechaNacimiento");
  }

  const mappedGender = record.gender
    ? mapOfficialGenderToLabel(record.gender)
    : null;
  if (mappedGender) {
    updated.genero = mappedGender;
    filled.push("genero");
  }

  updated.nacionalidad =
    verifikType === "CC" ? "Colombiana" : updated.nacionalidad || "Extranjera";
  filled.push("nacionalidad");

  return { updated, filled, parsedNames };
}

function resolveExpiryDate(
  catValidUntil?: string | null,
  licExpiryDate?: string | null,
): string | null {
  const rawDate = catValidUntil || licExpiryDate;
  if (!rawDate) return null;
  return toIsoDate(rawDate) ?? rawDate;
}

async function queryAndApplyDriverLicense(
  verifikService: VerifikService,
  verifikType: string,
  documentNumber: string,
  profile: Record<string, Record<string, unknown>>,
  logger: Logger,
): Promise<{
  number?: string;
  category?: string;
  expiryDate?: string | null;
  status?: string;
} | null> {
  try {
    const lic = await verifikService.getDriverLicense(
      verifikType,
      documentNumber,
    );
    if (!lic || lic.status === "NO_REGISTRA") {
      return null;
    }

    const motoCat = lic.categories.find(
      (c) =>
        c.category.toUpperCase().includes("A2") ||
        c.category.toUpperCase().includes("A1"),
    );
    const chosenCat = motoCat ?? lic.categories[0];
    const category =
      chosenCat?.category ?? lic.categories.map((c) => c.category).join(", ");
    const expiryDate = resolveExpiryDate(chosenCat?.validUntil, lic.expiryDate);

    const legal = profile["documentacion-legal"] ?? {};
    legal.licenciaConduccionNumero = lic.documentNumber || documentNumber;
    if (category) {
      legal.licenciaConduccionCategoria = category;
    }
    if (expiryDate) {
      legal.licenciaVigencia = expiryDate;
    }
    profile["documentacion-legal"] = legal;

    return {
      number: lic.documentNumber || documentNumber,
      category,
      expiryDate,
      status: lic.status,
    };
  } catch (err) {
    logger.warn(
      `Could not retrieve driver license for doc ${maskDocument(documentNumber)}: ${(err as Error).message}`,
    );
    return null;
  }
}

function updateProfileCompletion(user: UserDocument): void {
  const profile = user.profile ?? {};
  let completedSections = [...(user.completedSections ?? [])];

  for (const section of REQUIRED_PROFILE_SECTIONS) {
    const secData = profile[section] ?? {};
    const isValid = isSectionValid(
      section,
      secData,
      Boolean(user.identityVerified),
    );
    if (isValid) {
      if (!completedSections.includes(section)) {
        completedSections.push(section);
      }
    } else {
      completedSections = completedSections.filter((s) => s !== section);
    }
  }

  const profileCompleted =
    REQUIRED_PROFILE_SECTIONS.every((s) => completedSections.includes(s)) &&
    Boolean(user.identityVerified);

  user.completedSections = completedSections;
  user.profileCompleted = profileCompleted;
}

@Injectable()
export class IdentityVerificationService {
  private readonly logger = new Logger(IdentityVerificationService.name);
  private readonly throttle: IdentityAttemptThrottle;

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly verifikService: VerifikService,
    private readonly kvCache: KvCacheService,
    @Optional() private readonly birdContactService?: BirdContactService,
  ) {
    this.throttle = new IdentityAttemptThrottle(this.kvCache);
  }

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

  /** Runs the KYC verification for the document provided or stored in user's profile. */
  async verifyIdentity(
    userId: string,
    dto?: VerifyIdentityDto | string,
  ): Promise<IdentityVerifyResult> {
    if (!this.verifikService.isConfigured()) {
      throw new ServiceUnavailableException(
        "La verificación de identidad no está disponible en este momento.",
      );
    }

    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new BadRequestException("Usuario no encontrado");
    }

    const personal = user.profile?.["datos-personales"] ?? {};
    const { verifikType, documentNumber, verifikExpeditionDate } =
      extractAndValidateDocument(personal, dto);

    if (
      user.identityVerified &&
      user.identityVerification?.documentNumber === documentNumber
    ) {
      return {
        verified: true,
        message: "Tu identidad ya se encuentra verificada.",
        checks: null,
        autoFilledFields: [],
        officialData: {
          fullName: user.identityVerification.fullName,
          dateOfBirth: user.identityVerification.dateOfBirth,
          gender: user.identityVerification.gender,
          documentStatus: user.identityVerification.documentStatus,
          documentType: user.identityVerification.documentType,
          documentNumber: user.identityVerification.documentNumber,
        },
        profile: user.profile,
        completedSections: user.completedSections,
        profileCompleted: user.profileCompleted,
      };
    }

    const duplicateVerifiedUser = await this.userModel
      .findOne({
        _id: { $ne: user._id },
        identityVerified: true,
        "identityVerification.documentNumber": documentNumber,
      })
      .lean();

    if (duplicateVerifiedUser) {
      this.logger.warn(
        `Duplicate document verification attempted for doc ${maskDocument(documentNumber)} by user ${userId}`,
      );
      throw new BadRequestException(
        "Este número de documento ya se encuentra registrado y verificado por otro usuario.",
      );
    }

    await this.throttle.enforce(userId);

    let lookup: Awaited<ReturnType<typeof callVerifikService>>;
    try {
      lookup = await callVerifikService(
        this.verifikService,
        verifikType,
        documentNumber,
        verifikExpeditionDate,
      );
    } finally {
      await this.throttle.record(userId);
    }

    if (!lookup.ok) {
      handleLookupFailure(lookup, userId, documentNumber, this.logger);
    }

    const record = lookup.record;
    const checks = evaluateChecks(personal, verifikType, record);

    const failed = collectFailures(checks, record, verifikType);
    if (failed.length > 0) {
      this.logger.warn(
        `Identity mismatch for user ${userId} doc ${maskDocument(documentNumber)}: ${failed.join(", ")}`,
      );
      return {
        verified: false,
        message: buildFailureMessage(failed),
        checks,
        autoFilledFields: [],
        officialData: null,
      };
    }

    const profile = user.profile ?? {};
    const {
      updated: updatedPersonal,
      filled: autoFilledFields,
      parsedNames,
    } = applyOfficialPersonalData(
      personal,
      record,
      verifikType,
      documentNumber,
    );
    profile["datos-personales"] = updatedPersonal;

    const driverLicenseData = await queryAndApplyDriverLicense(
      this.verifikService,
      verifikType,
      documentNumber,
      profile,
      this.logger,
    );

    user.profile = profile;
    user.identityVerified = true;
    user.identityVerifiedAt = new Date();
    user.identityVerification = {
      documentType: verifikType,
      documentNumber: documentNumber,
      fullName:
        record.fullName ??
        [
          parsedNames.primerNombre,
          parsedNames.segundoNombre,
          parsedNames.primerApellido,
          parsedNames.segundoApellido,
        ]
          .filter(Boolean)
          .join(" "),
      firstName: [parsedNames.primerNombre, parsedNames.segundoNombre]
        .filter(Boolean)
        .join(" "),
      lastName: [parsedNames.primerApellido, parsedNames.segundoApellido]
        .filter(Boolean)
        .join(" "),
      dateOfBirth: record.dateOfBirth ? toIsoDate(record.dateOfBirth) : null,
      gender: record.gender,
      documentStatus: record.status,
      expirationDate: record.expirationDate,
      verifikId: record.verifikId,
      verifiedAt: user.identityVerifiedAt,
    };

    updateProfileCompletion(user);

    user.markModified("profile");
    await user.save();
    this.birdContactService?.syncUser(user).catch(() => {});

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
        firstName: user.identityVerification.firstName,
        lastName: user.identityVerification.lastName,
        dateOfBirth: user.identityVerification.dateOfBirth,
        gender: record.gender,
        documentStatus: record.status,
        documentType: mapVerifikTypeToLabel(verifikType),
        documentNumber,
        driverLicense: driverLicenseData,
      },
      profile: user.profile,
      completedSections: user.completedSections,
      profileCompleted: user.profileCompleted,
    };
  }
}
