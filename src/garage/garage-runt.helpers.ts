import { BadRequestException, Logger } from "@nestjs/common";
import { GarageMotorcycleDocument } from "./schemas/garage-motorcycle.schema";
import type { VerifyRuntDto } from "./dto/verify-runt.dto";
import type {
  VerifikService,
  VerifikRuntVehicleRecord,
  VerifikRuntLookupResult,
} from "../verifik/verifik.service";

export interface UserDocumentSource {
  identityVerification?: {
    documentType?: string;
    documentNumber?: string;
  } | null;
  profile?: Record<string, unknown>;
}

export function resolveUserDocumentForRunt(
  user: UserDocumentSource,
  dto?: VerifyRuntDto,
  moto?: GarageMotorcycleDocument,
): { documentType: string; documentNumber: string } {
  // 1. Explicitly provided in DTO
  if (dto?.documentNumber?.trim()) {
    return {
      documentType: (dto.documentType || "CC").trim().toUpperCase(),
      documentNumber: dto.documentNumber.trim().replace(/\D/g, ""),
    };
  }

  // 2. Owner document saved on the motorcycle (Licencia de Tránsito)
  if (moto?.runtDocumentHolder?.trim()) {
    return {
      documentType: (moto.runtDocumentType || "CC").trim().toUpperCase(),
      documentNumber: moto.runtDocumentHolder.trim().replace(/\D/g, ""),
    };
  }

  // 3. User's officially verified identity (if user is the owner)
  const verified = user.identityVerification;
  if (verified?.documentNumber?.trim()) {
    return {
      documentType: (verified.documentType || "CC").trim().toUpperCase(),
      documentNumber: verified.documentNumber.trim().replace(/\D/g, ""),
    };
  }

  // 4. User's personal profile document
  const personal = user.profile?.["datos-personales"] as
    Record<string, unknown> | undefined;
  const num = personal?.numeroDocumento;
  const tipo = personal?.tipoDocumento;

  if (typeof num === "string" && num.trim()) {
    return {
      documentType:
        typeof tipo === "string" && tipo.trim()
          ? tipo.trim().toUpperCase()
          : "CC",
      documentNumber: num.trim().replace(/\D/g, ""),
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
  moto.runtSoatStatus = soat?.status ?? "VIGENTE";
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
  moto.runtRtmStatus = rtm?.status ?? "VIGENTE";
}

export function applyRuntSync(
  moto: GarageMotorcycleDocument,
  runtRecord: VerifikRuntVehicleRecord,
  documentNumber: string,
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

  moto.isRuntVerified = true;
  moto.runtVerifiedAt = new Date();
  moto.runtDocumentHolder = documentNumber;

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
  if (documentNumber) {
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
    documentNumber
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
      `Verifik RUNT lookup failed for moto ${moto.plate} (user ${userId}): ${runtResult.message}`,
    );
    throw new BadRequestException(
      `Error al consultar el RUNT oficial: ${runtResult.message}`,
    );
  }

  const runtRecord = runtResult.record;
  const syncResult = applyRuntSync(moto, runtRecord, documentNumber);
  await moto.save();

  logger.log(
    `Motorcycle ${moto.plate} successfully verified with official RUNT via Verifik`,
  );

  return {
    success: true,
    verified: true,
    plate: moto.plate,
    verifiedAt: moto.runtVerifiedAt,
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
          status: moto.runtSoatStatus || "VIGENTE",
          policyNumber: moto.policyNumber || null,
          insuranceCompany: moto.insuranceCompany || null,
          startDate: null,
          expiryDate: moto.soatExpiryDate.toISOString().slice(0, 10),
        }
      : null,
    rtm: moto.rtmExpiryDate
      ? {
          status: moto.runtRtmStatus || "VIGENTE",
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
  );

  let updatedFields: string[] = [];
  let discrepancies: string[] = [];

  if (!diagnostic.runtUnavailable) {
    const syncRes = applyRuntSync(
      moto,
      diagnostic.vehicle,
      docNum || moto.runtDocumentHolder || "",
    );
    updatedFields = syncRes.updatedFields;
    discrepancies = syncRes.discrepancies;
  } else {
    logger.warn(
      `Motorcycle ${moto.plate} synced with partial data (RUNT offline: ${diagnostic.runtMessage})`,
    );
  }

  moto.fasecoldaCode = diagnostic.valuation.fasecoldaCode ?? moto.fasecoldaCode;
  moto.fasecoldaValue =
    diagnostic.valuation.fasecoldaValue ?? moto.fasecoldaValue;
  moto.sibgaValuation =
    diagnostic.valuation.sibgaValuation ?? moto.sibgaValuation;
  moto.finesCount = diagnostic.fines.totalFines;
  moto.finesTotalAmount = diagnostic.fines.totalAmount;
  moto.finesLastCheckedAt = new Date(diagnostic.fines.lastCheckedAt);
  moto.finesDetails = diagnostic.fines.fines as unknown as Record<
    string,
    unknown
  >[];
  moto.taxesStatus = diagnostic.taxes.status;
  moto.taxesPendingYears = diagnostic.taxes.pendingYears;
  moto.sinisterCount = diagnostic.sinister.sinisterCount;
  moto.sinisterDetails = diagnostic.sinister.records;
  moto.picoYPlacaRestrictedToday = diagnostic.picoYPlaca.hasRestrictionToday;
  moto.fullDiagnosticLastSyncedAt = new Date();

  await moto.save();

  logger.log(
    `Full Verifik diagnostic synced for moto ${moto.plate} (user ${userId}) [RUNT: ${
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
