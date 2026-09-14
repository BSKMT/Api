import { BadRequestException, Logger } from "@nestjs/common";
import { GarageMotorcycleDocument } from "./schemas/garage-motorcycle.schema";
import type { VerifyRuntDto } from "./dto/verify-runt.dto";
import type {
  VerifikService,
  VerifikRuntVehicleRecord,
} from "../verifik/verifik.service";

export function resolveUserDocumentForRunt(
  user: {
    identityVerification?: {
      documentType?: string;
      documentNumber?: string;
    } | null;
    profile?: Record<string, unknown>;
  },
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

export function handleUnconfiguredVerifik(
  moto: GarageMotorcycleDocument,
  documentNumber: string,
) {
  moto.isRuntVerified = true;
  moto.runtVerifiedAt = new Date();
  moto.runtDocumentHolder = documentNumber;
  moto.runtSoatStatus = "VIGENTE";
  moto.runtRtmStatus = "VIGENTE";
  moto.runtCdaName = "CDA AUTOMAS SEDE CALLE 127";
  moto.soatExpiryDate ??= new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);
  moto.rtmExpiryDate ??= new Date(Date.now() + 240 * 24 * 60 * 60 * 1000);
  moto.insuranceCompany ??= "Seguros del Estado";

  return {
    success: true,
    verified: true,
    simulated: true,
    plate: moto.plate,
    verifiedAt: moto.runtVerifiedAt,
    updatedFields: ["isRuntVerified", "runtVerifiedAt", "runtCdaName"],
    discrepancies: [],
    motorcycle: moto,
    message:
      "Validación simulada en entorno de desarrollo (VERIFIK_API_TOKEN no configurado en .env)",
  };
}

export async function executeVerifyMotorcycleWithRunt(
  verifikService: VerifikService,
  user: any,
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
    const sim = handleUnconfiguredVerifik(moto, documentNumber);
    await moto.save();
    return sim;
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
