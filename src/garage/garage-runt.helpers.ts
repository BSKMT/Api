import { BadRequestException, Logger } from "@nestjs/common";
import { GarageMotorcycleDocument } from "./schemas/garage-motorcycle.schema";
import type { VerifyRuntDto } from "./dto/verify-runt.dto";
import type {
  VerifikService,
  VerifikRuntVehicleRecord,
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
): { documentType: string; documentNumber: string } {
  if (dto?.documentNumber && dto?.documentType) {
    return {
      documentType: dto.documentType.trim().toUpperCase(),
      documentNumber: dto.documentNumber.trim().replace(/\D/g, ""),
    };
  }

  const verified = user.identityVerification;
  if (verified?.documentNumber && verified?.documentType) {
    return {
      documentType: verified.documentType.trim().toUpperCase(),
      documentNumber: verified.documentNumber.trim().replace(/\D/g, ""),
    };
  }

  const personal = user.profile?.["datos-personales"] as
    Record<string, unknown> | undefined;
  const num = personal?.numeroDocumento;
  const tipo = personal?.tipoDocumento;

  if (num && typeof num === "string" && num.trim()) {
    return {
      documentType:
        typeof tipo === "string" && tipo.trim()
          ? tipo.trim().toUpperCase()
          : "CC",
      documentNumber: num.trim().replace(/\D/g, ""),
    };
  }

  throw new BadRequestException(
    "Para consultar el RUNT oficial se requiere el número de identificación del propietario. Por favor ingrésalo o completa tu verificación de identidad.",
  );
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
  );

  if (!verifikService.isConfigured()) {
    throw new BadRequestException(
      "El servicio de verificación Verifik no está configurado en el servidor.",
    );
  }

  const runtResult = await verifikService.verifyRuntVehicle(
    documentType,
    documentNumber,
    moto.plate,
  );

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
    const res = resolveUserDocumentForRunt(user, dto);
    docType = res.documentType;
    docNum = res.documentNumber;
  } catch {
    // optional document holder
  }

  const queryKey = moto.vinOrEngineNumber || moto.plate;
  const diagnostic = await verifikService.getFullVehicleDiagnostic(
    queryKey,
    docNum || undefined,
    docType,
  );

  applyRuntSync(
    moto,
    diagnostic.vehicle,
    docNum || moto.runtDocumentHolder || "",
  );
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
    `Full Verifik diagnostic synced for moto ${moto.plate} (user ${userId})`,
  );

  return {
    success: true,
    diagnostic,
    motorcycle: moto,
  };
}
