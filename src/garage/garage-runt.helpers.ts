import { BadRequestException, Logger } from "@nestjs/common";
import { GarageMotorcycleDocument } from "./schemas/garage-motorcycle.schema";
import type { VerifyRuntDto } from "./dto/verify-runt.dto";
import type {
  VerifikService,
  VerifikRuntVehicleRecord,
  VerifikRuntLookupResult,
} from "../verifik/verifik.service";
import {
  normalizeRuntDocumentType,
  normalizeRuntDocumentNumber,
  RUNT_VEHICLE_ALLOWED_DOC_TYPES,
} from "../verifik/verifik-runt.helpers";
import { sanitizeForLog } from "../common/utils/log-redact.util";

export interface UserDocumentSource {
  identityVerification?: {
    documentType?: string;
    documentNumber?: string;
    lastName?: string | null;
  } | null;
  profile?: Record<string, unknown>;
}

export function extractUserPrimerApellido(
  user: UserDocumentSource,
): string | undefined {
  const personal = user.profile?.["datos-personales"] as
    Record<string, unknown> | undefined;
  const fromProfile =
    typeof personal?.primerApellido === "string"
      ? personal.primerApellido.trim()
      : "";
  if (fromProfile.length >= 2) return fromProfile;

  const fromKyc = (user.identityVerification?.lastName ?? "")
    .trim()
    .split(/\s+/)[0];
  return fromKyc && fromKyc.length >= 2 ? fromKyc : undefined;
}

export function resolveUserDocumentForRunt(
  user: UserDocumentSource,
  dto?: VerifyRuntDto,
  moto?: GarageMotorcycleDocument,
): { documentType: string; documentNumber: string } {
  // 1. Explicitly provided in DTO
  if (dto?.documentNumber?.trim()) {
    const docType = normalizeRuntDocumentType(dto.documentType);
    return {
      documentType: docType,
      documentNumber: normalizeRuntDocumentNumber(docType, dto.documentNumber),
    };
  }

  // 2. Owner document saved on the motorcycle (Licencia de Tránsito)
  if (moto?.runtDocumentHolder?.trim()) {
    const docType = normalizeRuntDocumentType(moto.runtDocumentType);
    return {
      documentType: docType,
      documentNumber: normalizeRuntDocumentNumber(
        docType,
        moto.runtDocumentHolder,
      ),
    };
  }

  // 3. User's officially verified identity (if user is the owner)
  const verified = user.identityVerification;
  if (verified?.documentNumber?.trim()) {
    const docType = normalizeRuntDocumentType(verified.documentType);
    return {
      documentType: docType,
      documentNumber: normalizeRuntDocumentNumber(
        docType,
        verified.documentNumber,
      ),
    };
  }

  // 4. User's personal profile document
  const personal = user.profile?.["datos-personales"] as
    Record<string, unknown> | undefined;
  const num = personal?.numeroDocumento;
  const tipo = personal?.tipoDocumento;

  if (typeof num === "string" && num.trim()) {
    const docType = normalizeRuntDocumentType(
      typeof tipo === "string" ? tipo : "CC",
    );
    return {
      documentType: docType,
      documentNumber: normalizeRuntDocumentNumber(docType, num),
    };
  }

  // 5. Default fallback (plate-only search will take over)
  return {
    documentType: "CC",
    documentNumber: "",
  };
}

export function syncRuntSoat(
  moto: GarageMotorcycleDocument,
  soat: VerifikRuntVehicleRecord["soat"],
  updatedFields: string[],
  discrepancies: string[],
): void {
  if (soat?.expiryDate) {
    const newDate = new Date(soat.expiryDate);
    if (!Number.isNaN(newDate.getTime())) {
      if (
        moto.soatExpiryDate &&
        moto.soatExpiryDate.toISOString().slice(0, 10) !==
          newDate.toISOString().slice(0, 10)
      ) {
        discrepancies.push(
          `Fecha SOAT previa (${moto.soatExpiryDate.toISOString().slice(0, 10)}) actualizada con RUNT (${newDate.toISOString().slice(0, 10)})`,
        );
      }
      moto.soatExpiryDate = newDate;
      updatedFields.push("soatExpiryDate");
    }
  }
  if (soat?.insuranceCompany) {
    moto.insuranceCompany = soat.insuranceCompany;
    updatedFields.push("insuranceCompany");
  }
  if (soat?.policyNumber) {
    moto.policyNumber = soat.policyNumber;
    updatedFields.push("policyNumber");
  }
  if (soat?.status) {
    moto.runtSoatStatus = soat.status;
  } else if (soat === null) {
    moto.runtSoatStatus = null;
  }
}

export function syncRuntRtm(
  moto: GarageMotorcycleDocument,
  rtm: VerifikRuntVehicleRecord["rtm"],
  updatedFields: string[],
  discrepancies: string[],
): void {
  if (rtm?.expiryDate) {
    const newDate = new Date(rtm.expiryDate);
    if (!Number.isNaN(newDate.getTime())) {
      if (
        moto.rtmExpiryDate &&
        moto.rtmExpiryDate.toISOString().slice(0, 10) !==
          newDate.toISOString().slice(0, 10)
      ) {
        discrepancies.push(
          `Fecha RTM previa (${moto.rtmExpiryDate.toISOString().slice(0, 10)}) actualizada con RUNT (${newDate.toISOString().slice(0, 10)})`,
        );
      }
      moto.rtmExpiryDate = newDate;
      updatedFields.push("rtmExpiryDate");
    }
  }
  if (rtm?.cdaName) {
    moto.runtCdaName = rtm.cdaName;
    updatedFields.push("runtCdaName");
  }
  if (rtm?.status) {
    moto.runtRtmStatus = rtm.status;
  } else if (rtm === null) {
    moto.runtRtmStatus = null;
  }
}

export function applyRuntSync(
  moto: GarageMotorcycleDocument,
  runtRecord: VerifikRuntVehicleRecord,
  documentNumber: string,
  ownershipVerified: boolean,
): { updatedFields: string[]; discrepancies: string[] } {
  const updatedFields: string[] = [];
  const discrepancies: string[] = [];

  syncRuntSoat(moto, runtRecord.soat, updatedFields, discrepancies);
  syncRuntRtm(moto, runtRecord.rtm, updatedFields, discrepancies);

  if (!moto.vinOrEngineNumber && runtRecord.vinOrChassis) {
    moto.vinOrEngineNumber = runtRecord.vinOrChassis;
    updatedFields.push("vinOrEngineNumber");
  }
  if (
    (!moto.displacementCc || moto.displacementCc === 250) &&
    runtRecord.displacementCc
  ) {
    moto.displacementCc = runtRecord.displacementCc;
    updatedFields.push("displacementCc");
  }

  // H-03: Only mark motorcycle as RUNT ownership-verified when document+plate matched.
  if (ownershipVerified) {
    moto.isRuntVerified = true;
    moto.runtVerifiedAt = new Date();
    if (documentNumber) {
      moto.runtDocumentHolder = documentNumber;
    }
  }

  return { updatedFields, discrepancies };
}

export async function executeVerifyMotorcycleWithRunt(
  verifikService: VerifikService,
  user: UserDocumentSource,
  moto: GarageMotorcycleDocument,
  dto: VerifyRuntDto | undefined,
  userId: string,
  logger: Logger,
) {
  const { documentType, documentNumber } = resolveUserDocumentForRunt(
    user,
    dto,
    moto,
  );

  if (!verifikService.isConfigured()) {
    throw new BadRequestException(
      "El servicio de verificación Verifik no está configurado en el servidor.",
    );
  }

  let runtResult: VerifikRuntLookupResult;
  const canQueryOwnerBound =
    Boolean(documentNumber) && RUNT_VEHICLE_ALLOWED_DOC_TYPES.has(documentType);
  if (canQueryOwnerBound) {
    runtResult = await verifikService.verifyRuntVehicle(
      documentType,
      documentNumber,
      moto.plate,
    );
  } else {
    runtResult = await verifikService.verifyRuntVehicleByPlate(moto.plate);
  }

  // If primary document lookup failed, fallback to plate-only lookup
  if (
    !runtResult.ok &&
    runtResult.reason !== "unauthorized" &&
    canQueryOwnerBound
  ) {
    const plateResult = await verifikService.verifyRuntVehicleByPlate(
      moto.plate,
    );
    if (plateResult.ok) {
      runtResult = plateResult;
    }
  }

  if (!runtResult.ok) {
    logger.warn(
      `Verifik RUNT lookup failed for moto ${sanitizeForLog(moto.plate)} (user ${userId}): ${sanitizeForLog(runtResult.message)}`,
    );
    throw new BadRequestException(
      `Error al consultar el RUNT oficial: ${runtResult.message}`,
    );
  }

  const runtRecord = runtResult.record;
  const ownershipVerified = runtResult.ownershipVerified === true;
  const syncResult = applyRuntSync(
    moto,
    runtRecord,
    documentNumber,
    ownershipVerified,
  );
  await moto.save();

  logger.log(
    `Motorcycle ${sanitizeForLog(moto.plate)} RUNT sync complete (ownershipVerified=${ownershipVerified})`,
  );

  return {
    success: true,
    verified: ownershipVerified,
    ownershipVerified,
    plate: moto.plate,
    verifiedAt: ownershipVerified ? moto.runtVerifiedAt : null,
    runtRecord,
    updatedFields: syncResult.updatedFields,
    discrepancies: syncResult.discrepancies,
    motorcycle: moto,
  };
}

export async function executeSyncMotorcycleWithVerifik(
  verifikService: VerifikService,
  user: UserDocumentSource,
  moto: GarageMotorcycleDocument,
  dto: VerifyRuntDto | undefined,
  userId: string,
  logger: Logger,
) {
  let docType = "CC";
  let docNum = "";
  try {
    const res = resolveUserDocumentForRunt(user, dto, moto);
    docType = res.documentType;
    docNum = res.documentNumber;
  } catch {
    docNum = moto.runtDocumentHolder || "";
  }

  const existingFallback: Partial<VerifikRuntVehicleRecord> = {
    plate: moto.plate,
    brand: moto.brand,
    modelLine: moto.modelLine,
    year: moto.year,
    displacementCc: moto.displacementCc,
    color: moto.color,
    vinOrChassis: moto.vinOrEngineNumber,
    classType: moto.motorcycleType,
    soat: moto.soatExpiryDate
      ? {
          status: moto.runtSoatStatus ?? null,
          policyNumber: moto.policyNumber || null,
          insuranceCompany: moto.insuranceCompany || null,
          startDate: null,
          expiryDate: moto.soatExpiryDate.toISOString().slice(0, 10),
        }
      : null,
    rtm: moto.rtmExpiryDate
      ? {
          status: moto.runtRtmStatus ?? null,
          certificateNumber: null,
          cdaName: moto.runtCdaName || null,
          expeditionDate: null,
          expiryDate: moto.rtmExpiryDate.toISOString().slice(0, 10),
        }
      : null,
  };

  const diagnostic = await verifikService.getFullVehicleDiagnostic(
    {
      plate: moto.plate,
      fallbackRecord: existingFallback,
    },
    docNum || undefined,
    docType,
    existingFallback,
    extractUserPrimerApellido(user),
  );

  let updatedFields: string[] = [];
  let discrepancies: string[] = [];

  if (!diagnostic.runtUnavailable) {
    const syncRes = applyRuntSync(
      moto,
      diagnostic.vehicle,
      docNum || moto.runtDocumentHolder || "",
      Boolean(diagnostic.ownershipVerified),
    );
    updatedFields = syncRes.updatedFields;
    discrepancies = syncRes.discrepancies;
  } else {
    logger.warn(
      `Motorcycle ${sanitizeForLog(moto.plate)} synced with partial data (RUNT offline: ${sanitizeForLog(diagnostic.runtMessage ?? "")})`,
    );
  }

  moto.fasecoldaCode = diagnostic.valuation.fasecoldaCode ?? moto.fasecoldaCode;
  moto.fasecoldaValue =
    diagnostic.valuation.fasecoldaValue ?? moto.fasecoldaValue;
  moto.sibgaValuation =
    diagnostic.valuation.sibgaValuation ?? moto.sibgaValuation;
  moto.finesCount = diagnostic.fines.totalFines;
  moto.finesTotalAmount = diagnostic.fines.totalAmount;
  moto.finesStatus = diagnostic.fines.status ?? null;
  moto.finesLastCheckedAt = new Date(diagnostic.fines.lastCheckedAt);
  moto.finesDetails = diagnostic.fines.fines as unknown as Record<
    string,
    unknown
  >[];
  moto.taxesStatus = diagnostic.taxes.status;
  moto.taxesPendingYears = diagnostic.taxes.pendingYears;
  moto.sinisterCount = diagnostic.sinister.sinisterCount;
  moto.sinisterStatus = diagnostic.sinister.status;
  moto.sinisterDetails = diagnostic.sinister.records;
  moto.picoYPlacaRestrictedToday = diagnostic.picoYPlaca.hasRestrictionToday;
  moto.fullDiagnosticLastSyncedAt = new Date();

  await moto.save();

  logger.log(
    `Full Verifik diagnostic synced for moto ${sanitizeForLog(moto.plate)} (user ${userId}) [RUNT: ${
      diagnostic.runtUnavailable ? "OFFLINE" : "OK"
    }]`,
  );

  return {
    success: true,
    diagnostic,
    motorcycle: moto,
    runtUnavailable: Boolean(diagnostic.runtUnavailable),
    runtMessage: diagnostic.runtMessage,
    updatedFields,
    discrepancies,
  };
}
