import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { EnvironmentConfig } from "../config/config.interface";
import { sanitizeForLog } from "../common/utils/log-redact.util";
import type {
  VerifikLookupResult,
  VerifikRuntLookupResult,
  VerifikRuntVehicleRecord,
  VerifikFinesRecord,
  VerifikTaxesRecord,
  VerifikValuationRecord,
  VerifikSinisterRecord,
  VerifikDriverLicenseRecord,
  VerifikFullDiagnosticRecord,
} from "./verifik.interfaces";
import {
  normalizeRuntVehicle,
  normalizeRuntDocumentType,
  normalizeRuntDocumentNumber,
  RUNT_VEHICLE_ALLOWED_DOC_TYPES,
  RUNT_DRIVER_ALLOWED_DOC_TYPES,
  BOGOTA_TAX_ALLOWED_DOC_TYPES,
} from "./verifik-runt.helpers";
import { normalizeIdentity } from "./verifik-identity.helpers";
import {
  executeVerifikFetch,
  extractVerifikRawError,
  isVerifikOutOfService409,
} from "./verifik-fetch.helper";
import {
  normalizeFines,
  normalizeTaxes,
  normalizeValuation,
  normalizeSinister,
  normalizeDriverLicense,
  calculatePicoYPlaca,
} from "./verifik-diagnostic.helpers";

interface DiagnosticTargetParams {
  plate: string;
  fallbackRecord?: Partial<VerifikRuntVehicleRecord>;
}

const VALID_PLATE_PATTERN = /^[A-Z0-9]{5,9}$/;

function sanitizePlate(plate: string): string {
  return (plate || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function parseDiagnosticTarget(
  queryKeyOrOptions:
    | string
    | {
        plate: string;
        fallbackRecord?: Partial<VerifikRuntVehicleRecord>;
      },
  existingFallback?: Partial<VerifikRuntVehicleRecord>,
): DiagnosticTargetParams {
  if (typeof queryKeyOrOptions === "object" && queryKeyOrOptions !== null) {
    return {
      plate: sanitizePlate(queryKeyOrOptions.plate),
      fallbackRecord: queryKeyOrOptions.fallbackRecord || existingFallback,
    };
  }

  return {
    plate: sanitizePlate(String(queryKeyOrOptions || "")),
    fallbackRecord: existingFallback,
  };
}

function buildFallbackVehicleRecord(
  plate: string,
  fallbackRecord?: Partial<VerifikRuntVehicleRecord>,
): VerifikRuntVehicleRecord {
  return {
    plate,
    brand: fallbackRecord?.brand ?? null,
    modelLine: fallbackRecord?.modelLine ?? null,
    year: fallbackRecord?.year ?? null,
    displacementCc: fallbackRecord?.displacementCc ?? null,
    color: fallbackRecord?.color ?? null,
    serviceType: fallbackRecord?.serviceType ?? "PARTICULAR",
    classType: fallbackRecord?.classType ?? "MOTOCICLETA",
    engineNumber: fallbackRecord?.engineNumber ?? null,
    vinOrChassis: fallbackRecord?.vinOrChassis ?? null,
    soat: fallbackRecord?.soat ?? null,
    rtm: fallbackRecord?.rtm ?? null,
    verifikId: null,
  };
}

function buildUnavailableFinesRecord(message: string): VerifikFinesRecord {
  return {
    hasFines: false,
    totalFines: 0,
    totalAmount: 0,
    fines: [],
    lastCheckedAt: new Date().toISOString(),
    status: "DESCONOCIDO",
    message,
  };
}

function buildUnavailableTaxesRecord(
  plate: string,
  message: string,
): VerifikTaxesRecord {
  return {
    plate,
    status: "DESCONOCIDO",
    pendingYears: [],
    totalAmount: 0,
    message,
  };
}

function buildUnavailableSinisterRecord(
  plate: string,
  message: string,
): VerifikSinisterRecord {
  return {
    plate,
    hasSinister: false,
    sinisterCount: 0,
    records: [],
    status: "DESCONOCIDO",
    message,
  };
}

function evaluateFinesFetchOutcome(
  settled: PromiseSettledResult<
    Awaited<ReturnType<typeof executeVerifikFetch>>
  >,
): { succeeded: boolean; data: unknown } {
  if (settled.status !== "fulfilled" || !settled.value.ok) {
    return { succeeded: false, data: null };
  }
  const { response, body } = settled.value;
  if (response.ok) {
    return { succeeded: true, data: body.data ?? body.value ?? null };
  }
  if (response.status === 404) {
    return { succeeded: true, data: null };
  }
  return { succeeded: false, data: null };
}

export type {
  VerifikIdentityRecord,
  VerifikLookupResult,
  VerifikSoatRecord,
  VerifikRtmRecord,
  VerifikRuntVehicleRecord,
  VerifikRuntLookupResult,
  VerifikDocumentType,
  VerifikFinesRecord,
  VerifikTaxesRecord,
  VerifikValuationRecord,
  VerifikSinisterRecord,
  VerifikPicoYPlacaRecord,
  VerifikDriverLicenseRecord,
  VerifikFullDiagnosticRecord,
} from "./verifik.interfaces";

@Injectable()
export class VerifikService {
  private readonly logger = new Logger(VerifikService.name);

  constructor(
    private readonly configService: ConfigService<EnvironmentConfig>,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.configService.get<string>("VERIFIK_API_TOKEN"));
  }

  async verifyCedulaPremium(
    documentNumber: string,
  ): Promise<VerifikLookupResult> {
    return this.getIdentity("/v2/co/cedula/premium", { documentNumber });
  }

  async verifyCe(
    documentNumber: string,
    expeditionDate: string,
  ): Promise<VerifikLookupResult> {
    return this.getIdentity("/v2/co/foreigner-id/ce", {
      documentNumber,
      expeditionDate,
    });
  }

  async verifyPpt(
    documentNumber: string,
    expeditionDate: string,
  ): Promise<VerifikLookupResult> {
    return this.getIdentity("/v2/co/foreigner-id/ppt", {
      documentNumber,
      expeditionDate,
    });
  }

  async verifyPep(
    documentNumber: string,
    expeditionDate: string,
  ): Promise<VerifikLookupResult> {
    return this.getIdentity("/v2/co/foreigner-id/pep", {
      documentNumber,
      expeditionDate,
    });
  }

  async verifyRuntVehicle(
    documentType: string,
    documentNumber: string,
    plate: string,
  ): Promise<VerifikRuntLookupResult> {
    const cleanDocType = normalizeRuntDocumentType(documentType);
    const cleanDocNumber = normalizeRuntDocumentNumber(
      cleanDocType,
      documentNumber,
    );
    const cleanPlate = sanitizePlate(plate);

    if (!VALID_PLATE_PATTERN.test(cleanPlate)) {
      return {
        ok: false,
        reason: "invalid_input",
        message: "La placa debe tener entre 5 y 9 caracteres alfanuméricos.",
      };
    }

    if (!RUNT_VEHICLE_ALLOWED_DOC_TYPES.has(cleanDocType) || !cleanDocNumber) {
      return {
        ok: false,
        reason: "invalid_input",
        message:
          "El RUNT vehicular solo admite documentos tipo CC, CE, PA o NIT con número válido.",
      };
    }

    // 1. Primary: /v2/co/runt/vehicle-by-plate (official full RUNT record with SOAT & RTM)
    const primaryResult = await this.getRuntVehicle(
      "/v2/co/runt/vehicle-by-plate",
      {
        documentType: cleanDocType,
        documentNumber: cleanDocNumber,
        plate: cleanPlate,
      },
      true,
    );

    if (primaryResult.ok) {
      return primaryResult;
    }

    // 2. Fallback to /v2/co/runt/vehiculo ONLY when primary is temporarily unavailable.
    // Never chain paid RUNT calls on 404 NotFound (Verifik bills 404 on every RUNT route).
    if (primaryResult.reason === "unavailable") {
      const basicResult = await this.getRuntVehicle(
        "/v2/co/runt/vehiculo",
        {
          documentType: cleanDocType,
          documentNumber: cleanDocNumber,
          plate: cleanPlate,
        },
        true,
      );
      if (basicResult.ok) {
        return basicResult;
      }
    }

    // Do NOT silently fall back to plate-only here (H-02/H-03):
    // callers that need non-ownership plate lookup call verifyRuntVehicleByPlate() explicitly.
    return primaryResult;
  }

  async verifyRuntVehicleOwners(
    plate: string,
  ): Promise<VerifikRuntLookupResult> {
    const cleanPlate = sanitizePlate(plate);
    if (!VALID_PLATE_PATTERN.test(cleanPlate)) {
      return {
        ok: false,
        reason: "invalid_input",
        message: "La placa debe tener entre 5 y 9 caracteres alfanuméricos.",
      };
    }
    return this.getRuntVehicle(
      "/v2/co/runt/propietarios",
      { plate: cleanPlate },
      false,
    );
  }

  async verifyRuntVehicleByPlate(
    plate: string,
  ): Promise<VerifikRuntLookupResult> {
    const cleanPlate = sanitizePlate(plate);
    if (!VALID_PLATE_PATTERN.test(cleanPlate)) {
      return {
        ok: false,
        reason: "invalid_input",
        message: "La placa debe tener entre 5 y 9 caracteres alfanuméricos.",
      };
    }

    // 1. Primary: /v2/co/runt/vehicle-by-plate-only (full RUNT record without owner document)
    const result = await this.getRuntVehicle(
      "/v2/co/runt/vehicle-by-plate-only",
      { plate: cleanPlate },
      false,
    );
    if (result.ok) {
      return result;
    }

    // 2. Fallback to /v2/co/runt/propietarios ONLY when primary is unavailable
    if (result.reason === "unavailable") {
      const ownersResult = await this.verifyRuntVehicleOwners(cleanPlate);
      if (ownersResult.ok) {
        return ownersResult;
      }
    }

    return result;
  }

  async getVehicleFines(plate: string): Promise<VerifikFinesRecord> {
    const cleanPlate = sanitizePlate(plate);
    if (!VALID_PLATE_PATTERN.test(cleanPlate)) {
      return buildUnavailableFinesRecord(
        "Formato de placa inválido para consulta SIMIT.",
      );
    }

    // Official plate-based SIMIT endpoint is /v2/co/simit/consultar/placa
    // (/v2/co/simit/comparendos requires documentType+documentNumber, not plate).
    const [simitRes, bogotaRes] = await Promise.allSettled([
      executeVerifikFetch(
        this.configService,
        this.logger,
        "/v2/co/simit/consultar/placa",
        { plate: cleanPlate },
      ),
      executeVerifikFetch(
        this.configService,
        this.logger,
        "/v2/co/bogota/vehicle/fines",
        { plate: cleanPlate },
      ),
    ]);

    const simitOutcome = evaluateFinesFetchOutcome(simitRes);
    const bogotaOutcome = evaluateFinesFetchOutcome(bogotaRes);

    if (!simitOutcome.succeeded && !bogotaOutcome.succeeded) {
      return buildUnavailableFinesRecord(
        "Las plataformas SIMIT y Movilidad Bogotá no están disponibles en este momento.",
      );
    }

    const simitFines = normalizeFines(simitOutcome.data);
    const bogotaFines = normalizeFines(bogotaOutcome.data);

    const combinedFines = [...simitFines.fines];
    for (const f of bogotaFines.fines) {
      if (!combinedFines.some((x) => x.id && x.id === f.id)) {
        combinedFines.push(f);
      }
    }

    const totalAmount = combinedFines.reduce(
      (acc, curr) => acc + (curr.amount || 0),
      0,
    );

    const status: VerifikFinesRecord["status"] =
      simitOutcome.succeeded && bogotaOutcome.succeeded
        ? "VERIFICADO"
        : "PARCIAL";

    return {
      hasFines: combinedFines.length > 0,
      totalFines: combinedFines.length,
      totalAmount,
      fines: combinedFines,
      lastCheckedAt: new Date().toISOString(),
      status,
    };
  }

  async getVehicleTaxes(
    plate: string,
    documentType?: string,
    documentNumber?: string,
  ): Promise<VerifikTaxesRecord> {
    const cleanPlate = sanitizePlate(plate);
    const cleanDocType = documentType
      ? normalizeRuntDocumentType(documentType)
      : "";
    const cleanDocNumber = cleanDocType
      ? normalizeRuntDocumentNumber(cleanDocType, documentNumber)
      : "";

    // Official Verifik docs: /v2/co/bogota/vehicle/tax REQUIRES plate, documentType (CC|NIT), documentNumber.
    if (
      !VALID_PLATE_PATTERN.test(cleanPlate) ||
      !BOGOTA_TAX_ALLOWED_DOC_TYPES.has(cleanDocType) ||
      !cleanDocNumber
    ) {
      return buildUnavailableTaxesRecord(
        cleanPlate,
        "La consulta de impuestos distritales de Bogotá requiere placa y documento del propietario (CC o NIT).",
      );
    }

    const fetchResult = await executeVerifikFetch(
      this.configService,
      this.logger,
      "/v2/co/bogota/vehicle/tax",
      {
        plate: cleanPlate,
        documentType: cleanDocType,
        documentNumber: cleanDocNumber,
      },
    );

    if (!fetchResult.ok || !fetchResult.response.ok || !fetchResult.body.data) {
      return buildUnavailableTaxesRecord(
        cleanPlate,
        "La plataforma de impuestos distritales no está disponible en este momento para verificar el estado de cuenta.",
      );
    }

    return normalizeTaxes(fetchResult.body.data, cleanPlate);
  }

  async getVehicleValuation(
    plate: string,
    options?: {
      documentType?: string;
      documentNumber?: string;
      vehicleYear?: number | null;
    },
  ): Promise<VerifikValuationRecord> {
    const cleanPlate = sanitizePlate(plate);
    const sibgaParams: Record<string, string> = { plate: cleanPlate };
    if (options?.documentType && options?.documentNumber) {
      const cleanDocType = normalizeRuntDocumentType(options.documentType);
      const cleanDocNum = normalizeRuntDocumentNumber(
        cleanDocType,
        options.documentNumber,
      );
      // Official SIBGA docs: documentType & documentNumber must be sent together (CC|CE|PA|NIT)
      if (RUNT_VEHICLE_ALLOWED_DOC_TYPES.has(cleanDocType) && cleanDocNum) {
        sibgaParams.documentType = cleanDocType;
        sibgaParams.documentNumber = cleanDocNum;
      }
    }

    const [fasecoldaRes, sibgaRes] = await Promise.allSettled([
      executeVerifikFetch(
        this.configService,
        this.logger,
        "/v2/co/fasecolda/values-by-plate",
        { plate: cleanPlate },
      ),
      executeVerifikFetch(
        this.configService,
        this.logger,
        "/v2/co/sibga/valuation",
        sibgaParams,
      ),
    ]);

    const rawF =
      fasecoldaRes.status === "fulfilled" &&
      fasecoldaRes.value.ok &&
      fasecoldaRes.value.response.ok
        ? fasecoldaRes.value.body.data
        : null;
    const rawS =
      sibgaRes.status === "fulfilled" &&
      sibgaRes.value.ok &&
      sibgaRes.value.response.ok
        ? sibgaRes.value.body.data
        : null;

    return normalizeValuation(rawF, rawS, cleanPlate, options?.vehicleYear);
  }

  async getVehicleSinister(plate: string): Promise<VerifikSinisterRecord> {
    const cleanPlate = sanitizePlate(plate);
    if (!VALID_PLATE_PATTERN.test(cleanPlate)) {
      return buildUnavailableSinisterRecord(
        cleanPlate,
        "Formato de placa inválido para consulta de siniestros.",
      );
    }

    const fetchResult = await executeVerifikFetch(
      this.configService,
      this.logger,
      "/v2/co/fasecolda/sinister",
      { plate: cleanPlate },
    );

    if (!fetchResult.ok || !fetchResult.response.ok || !fetchResult.body.data) {
      return buildUnavailableSinisterRecord(
        cleanPlate,
        "La plataforma de consulta de siniestros no se encuentra disponible temporalmente.",
      );
    }

    return normalizeSinister(fetchResult.body.data, cleanPlate);
  }

  async getDriverLicense(
    documentType: string,
    documentNumber: string,
    primerApellido?: string,
  ): Promise<VerifikDriverLicenseRecord> {
    const cleanDocType = normalizeRuntDocumentType(documentType);
    const cleanDocNumber = normalizeRuntDocumentNumber(
      cleanDocType,
      documentNumber,
    );

    if (!RUNT_DRIVER_ALLOWED_DOC_TYPES.has(cleanDocType) || !cleanDocNumber) {
      return {
        documentNumber: cleanDocNumber,
        documentType: cleanDocType,
        status: "NO_REGISTRA",
        categories: [],
        expeditionDate: null,
        expiryDate: null,
      };
    }

    const cleanSurname = (primerApellido ?? "").trim();
    const hasSurname = cleanSurname.length >= 2;

    // Official Verifik docs: PA (passport) strictly requires primerApellido.
    if (cleanDocType === "PA" && !hasSurname) {
      return {
        documentNumber: cleanDocNumber,
        documentType: cleanDocType,
        status: "DESCONOCIDO",
        categories: [],
        expeditionDate: null,
        expiryDate: null,
      };
    }

    // Use Basic v3 endpoint when primerApellido is known (billed at Basic rate, not Premium).
    const endpoint = hasSurname
      ? "/v3/co/runt/conductor"
      : "/v2/co/runt/conductor";
    const params: Record<string, string> = {
      documentType: cleanDocType,
      documentNumber: cleanDocNumber,
      ...(hasSurname ? { primerApellido: cleanSurname } : {}),
    };

    const fetchResult = await executeVerifikFetch(
      this.configService,
      this.logger,
      endpoint,
      params,
    );

    if (!fetchResult.ok) {
      return {
        documentNumber: cleanDocNumber,
        documentType: cleanDocType,
        status: "DESCONOCIDO",
        categories: [],
        expeditionDate: null,
        expiryDate: null,
      };
    }

    if (fetchResult.response.status === 404) {
      return {
        documentNumber: cleanDocNumber,
        documentType: cleanDocType,
        status: "NO_REGISTRA",
        categories: [],
        expeditionDate: null,
        expiryDate: null,
      };
    }

    if (!fetchResult.response.ok || !fetchResult.body.data) {
      return {
        documentNumber: cleanDocNumber,
        documentType: cleanDocType,
        status: "DESCONOCIDO",
        categories: [],
        expeditionDate: null,
        expiryDate: null,
      };
    }

    return normalizeDriverLicense(
      fetchResult.body.data,
      cleanDocType,
      cleanDocNumber,
    );
  }

  private async resolveRuntVehicle(
    plate: string,
    userDocHolder?: string,
    userDocType?: string,
  ): Promise<{
    vehicleResult: VerifikRuntLookupResult | null;
    resolvedPlate: string;
  }> {
    let vehicleResult: VerifikRuntLookupResult | null = null;
    const resolvedPlate = plate;

    if (plate && userDocHolder) {
      const normalizedType = normalizeRuntDocumentType(userDocType ?? "CC");
      if (RUNT_VEHICLE_ALLOWED_DOC_TYPES.has(normalizedType)) {
        const docResult = await this.verifyRuntVehicle(
          normalizedType,
          userDocHolder,
          plate,
        );
        if (docResult.ok) {
          return { vehicleResult: docResult, resolvedPlate };
        }
        vehicleResult = docResult;
      }
    }

    if (plate) {
      const plateResult = await this.verifyRuntVehicleByPlate(plate);
      if (plateResult.ok) {
        return { vehicleResult: plateResult, resolvedPlate };
      }
      vehicleResult ??= plateResult;
    }

    return { vehicleResult, resolvedPlate };
  }

  async getFullVehicleDiagnostic(
    queryKeyOrOptions:
      | string
      | {
          plate: string;
          fallbackRecord?: Partial<VerifikRuntVehicleRecord>;
        },
    userDocHolder?: string,
    userDocType?: string,
    existingFallback?: Partial<VerifikRuntVehicleRecord>,
    primerApellido?: string,
  ): Promise<VerifikFullDiagnosticRecord> {
    const { plate: initialPlate, fallbackRecord } = parseDiagnosticTarget(
      queryKeyOrOptions,
      existingFallback,
    );

    const { vehicleResult, resolvedPlate } = await this.resolveRuntVehicle(
      initialPlate,
      userDocHolder,
      userDocType,
    );

    const foundPlate = vehicleResult?.ok ? vehicleResult.record.plate : "";
    const plate = resolvedPlate || foundPlate || initialPlate;

    let vehicle: VerifikRuntVehicleRecord;
    let runtUnavailable = false;
    let runtMessage: string | undefined;

    if (vehicleResult?.ok) {
      vehicle = vehicleResult.record;
    } else {
      runtUnavailable = true;
      runtMessage =
        vehicleResult?.message ||
        "La verificación con el RUNT no está disponible en este momento.";

      if (!plate) {
        throw new BadRequestException(
          `No fue posible consultar el vehículo en Verifik RUNT: ${runtMessage}`,
        );
      }

      this.logger.warn(
        `Verifik RUNT lookup failed for plate ${sanitizeForLog(plate)}: ${sanitizeForLog(runtMessage)}. Fallback record used to continue diagnostics.`,
      );
      vehicle = buildFallbackVehicleRecord(plate, fallbackRecord);
    }

    const [fines, taxes, valuation, sinister, license] = await Promise.all([
      this.getVehicleFines(plate).catch(() =>
        buildUnavailableFinesRecord(
          "No fue posible consultar multas SIMIT en este momento.",
        ),
      ),
      this.getVehicleTaxes(plate, userDocType, userDocHolder).catch(() =>
        buildUnavailableTaxesRecord(
          plate,
          "No fue posible consultar impuestos vehiculares en este momento.",
        ),
      ),
      this.getVehicleValuation(plate, {
        documentType: userDocType,
        documentNumber: userDocHolder,
        vehicleYear: vehicle.year,
      }).catch(() => normalizeValuation(null, null, plate, vehicle.year)),
      this.getVehicleSinister(plate).catch(() =>
        buildUnavailableSinisterRecord(
          plate,
          "No fue posible consultar siniestros Fasecolda en este momento.",
        ),
      ),
      userDocHolder
        ? this.getDriverLicense(
            userDocType ?? "CC",
            userDocHolder,
            primerApellido,
          ).catch(() => null)
        : Promise.resolve(null),
    ]);

    const picoYPlaca = calculatePicoYPlaca(plate, "bogota");

    return {
      vehicle,
      fines,
      taxes,
      valuation,
      sinister,
      picoYPlaca,
      license,
      syncedAt: new Date().toISOString(),
      source: "VERIFIK_OFFICIAL",
      ownershipVerified: Boolean(
        vehicleResult?.ok && vehicleResult.ownershipVerified,
      ),
      runtUnavailable,
      runtMessage: runtUnavailable ? runtMessage : undefined,
    };
  }

  private async getIdentity(
    path: string,
    params: Record<string, string>,
  ): Promise<VerifikLookupResult> {
    const fetchResult = await executeVerifikFetch(
      this.configService,
      this.logger,
      path,
      params,
    );
    if (!fetchResult.ok) {
      return fetchResult;
    }

    const { response, body } = fetchResult;

    if (response.status === 404) {
      return {
        ok: false,
        reason: "not_found",
        message:
          "No encontramos registros para el documento. Verifica el número y la fecha de expedición.",
      };
    }

    if (response.status === 409) {
      if (isVerifikOutOfService409(body)) {
        this.logger.warn(
          `Verifik identity 409 out-of-service on ${path}: ${sanitizeForLog(extractVerifikRawError(body))}`,
        );
        return {
          ok: false,
          reason: "unavailable",
          message:
            "El registro oficial (Registraduría / Migración) presenta indisponibilidad temporal. Intenta de nuevo en unos minutos.",
        };
      }
      return {
        ok: false,
        reason: "invalid_input",
        message:
          "Los datos del documento no cumplen el formato requerido. Verifica el número y la fecha de expedición.",
      };
    }

    if (response.status === 422) {
      return {
        ok: false,
        reason: "invalid_input",
        message:
          "El formato de los datos enviados no es válido. Verifica el número de documento e intenta de nuevo.",
      };
    }

    if (response.status === 429) {
      this.logger.warn(`Verifik rate limit hit on ${path}`);
      return {
        ok: false,
        reason: "unavailable",
        message:
          "El servicio de verificación está saturado. Intenta de nuevo en unos minutos.",
      };
    }

    if (!response.ok || !body.data) {
      this.logger.error(
        `Verifik error ${response.status} on ${path}: ${sanitizeForLog(extractVerifikRawError(body))}`,
      );
      return {
        ok: false,
        reason: "unavailable",
        message: "La verificación de identidad no está disponible.",
      };
    }

    return {
      ok: true,
      record: normalizeIdentity(body.data, body.id),
    };
  }

  private async getRuntVehicle(
    path: string,
    params: Record<string, string>,
    ownershipVerified: boolean,
  ): Promise<VerifikRuntLookupResult> {
    const fetchResult = await executeVerifikFetch(
      this.configService,
      this.logger,
      path,
      params,
    );
    if (!fetchResult.ok) {
      return fetchResult;
    }

    const { response, body } = fetchResult;

    if (response.status === 404) {
      return {
        ok: false,
        reason: "not_found",
        message:
          "No encontramos registros en el RUNT para la placa y documento consultados.",
      };
    }

    if (response.status === 409) {
      if (isVerifikOutOfService409(body)) {
        this.logger.warn(`Verifik RUNT 409 out-of-service on ${path}`);
        return {
          ok: false,
          reason: "unavailable",
          message:
            "La plataforma oficial del RUNT no está disponible o se encuentra en mantenimiento temporal.",
        };
      }
      this.logger.warn(
        `Verifik RUNT 409 validation on ${path}: ${sanitizeForLog(extractVerifikRawError(body))}`,
      );
      return {
        ok: false,
        reason: "invalid_input",
        message:
          "Los datos consultados (placa o documento) no cumplen el formato requerido por el RUNT.",
      };
    }

    if (response.status === 422) {
      return {
        ok: false,
        reason: "invalid_input",
        message:
          "El formato de la placa o documento no es válido para el RUNT.",
      };
    }

    if (response.status === 429) {
      this.logger.warn(`Verifik rate limit hit on ${path}`);
      return {
        ok: false,
        reason: "unavailable",
        message:
          "El servicio de consulta RUNT está saturado. Intenta de nuevo en unos minutos.",
      };
    }

    if (!response.ok || !body.data) {
      this.logger.error(
        `Verifik RUNT error ${response.status} on ${path}: ${sanitizeForLog(extractVerifikRawError(body))}`,
      );
      const isUnavailable = response.status >= 500;
      const safeMessage = isUnavailable
        ? "La verificación con el RUNT no está disponible en este momento por mantenimiento de la fuente oficial."
        : "No fue posible consultar la motocicleta en el RUNT. Verifica la placa y el documento del propietario.";
      return {
        ok: false,
        reason: isUnavailable ? "unavailable" : "invalid_input",
        message: safeMessage,
      };
    }

    const payloadData = Array.isArray(body.data)
      ? (body.data[0] as Record<string, unknown>)
      : (body.data as Record<string, unknown>);

    return {
      ok: true,
      record: normalizeRuntVehicle(payloadData, body.id, params.plate || ""),
      ownershipVerified,
    };
  }
}
