import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { User, UserDocument } from "../users/schemas/user.schema";
import { VerifikService } from "../verifik/verifik.service";
import { maskDocument } from "../common/utils/log-redact.util";
import {
  REQUIRES_EXPEDITION_DATE,
  mapDocumentType,
} from "./identity-verification-matcher";
import type {
  CheckOutcome,
  IdentityCheckResult,
  IdentityVerificationStatus,
  IdentityVerifyResult,
} from "./identity-verification.types";
import {
  toIsoDate,
  evaluateChecks,
  collectFailures,
  buildFailureMessage,
  applyAutoFill,
} from "./identity-verification-checks";
import {
  IdentityAttemptThrottle,
  extractAndValidateDocument,
  handleLookupFailure,
  callVerifikService,
} from "./identity-verification.helpers";

export type {
  CheckOutcome,
  IdentityCheckResult,
  IdentityVerificationStatus,
  IdentityVerifyResult,
};
export { mapDocumentType };

@Injectable()
export class IdentityVerificationService {
  private readonly logger = new Logger(IdentityVerificationService.name);
  private readonly throttle = new IdentityAttemptThrottle();

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly verifikService: VerifikService,
  ) {}

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

  /** Runs the KYC verification for the document stored in user's profile. */
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
    const { verifikType, documentNumber, verifikExpeditionDate } =
      extractAndValidateDocument(personal, expeditionDate);

    this.throttle.enforce(userId);

    const lookup = await callVerifikService(
      this.verifikService,
      verifikType,
      documentNumber,
      verifikExpeditionDate,
    );

    this.throttle.record(userId);

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

    const autoFilledFields = applyAutoFill(user, personal, record);

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
      dateOfBirth: record.dateOfBirth ? toIsoDate(record.dateOfBirth) : null,
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
}
