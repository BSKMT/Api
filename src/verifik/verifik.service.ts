import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { EnvironmentConfig } from "../config/config.interface";
import { sanitizeForLog } from "../common/utils/log-redact.util";
import type {
  VerifikLookupResult,
  VerifikRuntLookupResult,
  VerifikFinesRecord,
  VerifikTaxesRecord,
  VerifikValuationRecord,
  VerifikSinisterRecord,
  VerifikDriverLicenseRecord,
  VerifikFullDiagnosticRecord,
} from "./verifik.interfaces";
import { normalizeRuntVehicle } from "./verifik-runt.helpers";
import { normalizeIdentity } from "./verifik-identity.helpers";
import { executeVerifikFetch } from "./verifik-fetch.helper";
import {
  normalizeFines,
  normalizeTaxes,
  normalizeValuation,
  normalizeSinister,
  calculatePicoYPlaca,
} from "./verifik-diagnostic.helpers";

function safeStr(val: unknown, fallback = ""): string {
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "boolean") return `${val}`;
  return fallback;
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
    const cleanDocNumber = documentNumber.replace(/\D/g, "");
    const cleanPlate = plate.trim().toUpperCase();
    const cleanDocType = documentType.trim().toUpperCase();

    // 1. Primary: /v2/co/runt/vehiculo
    let result = await this.getRuntVehicle("/v2/co/runt/vehiculo", {
      documentType: cleanDocType,
      documentNumber: cleanDocNumber,
      plate: cleanPlate,
    });

    // 2. Secondary fallback: /v2/co/runt/vehicle-by-plate (full history with document)
    if (!result.ok && result.reason !== "unauthorized") {
      const altResult = await this.getRuntVehicle("/v2/co/runt/vehicle-by-plate", {
        documentType: cleanDocType,
        documentNumber: cleanDocNumber,
        plate: cleanPlate,
      });
      if (altResult.ok) {
        return altResult;
      }
    }

    // 3. Tertiary fallback: /v2/co/runt/vehicle-by-plate-only (plate only)
    if (!result.ok && result.reason !== "unauthorized") {
      const plateOnlyResult = await this.getRuntVehicle(
        "/v2/co/runt/vehicle-by-plate-only",
        { plate: cleanPlate },
      );
      if (plateOnlyResult.ok) {
        return plateOnlyResult;
      }
    }

    return result;
  }

  async verifyRuntVehicleByVin(vin: string): Promise<VerifikRuntLookupResult> {
    const cleanVin = vin.trim().toUpperCase();
    return this.getRuntVehicle("/v2/co/runt/vehicle-by-vin", {
      vin: cleanVin,
    });
  }

  async verifyRuntVehicleOwners(plate: string): Promise<VerifikRuntLookupResult> {
    const cleanPlate = plate.trim().toUpperCase();
    return this.getRuntVehicle("/v2/co/runt/propietarios", {
      plate: cleanPlate,
    });
  }

  async verifyRuntVehicleByPlate(
    plate: string,
  ): Promise<VerifikRuntLookupResult> {
    const cleanPlate = plate.trim().toUpperCase();
    // 1. Primary: vehicle-by-plate-only
    const result = await this.getRuntVehicle(
      "/v2/co/runt/vehicle-by-plate-only",
      { plate: cleanPlate },
    );
    if (result.ok) {
      return result;
    }

    // 2. Fallback: propietarios
    const ownersResult = await this.verifyRuntVehicleOwners(cleanPlate);
    if (ownersResult.ok) {
      return ownersResult;
    }

    return result;
  }

  async getVehicleFines(plate: string): Promise<VerifikFinesRecord> {
    const cleanPlate = plate.trim().toUpperCase();
    const [simitRes, bogotaRes] = await Promise.allSettled([
      executeVerifikFetch(
        this.configService,
        this.logger,
        "/v2/co/simit/comparendos",
        { plate: cleanPlate },
      ),
      executeVerifikFetch(
        this.configService,
        this.logger,
        "/v2/co/bogota/vehicle/fines",
        { plate: cleanPlate },
      ),
    ]);

    const simitData =
      simitRes.status === "fulfilled" && simitRes.value.ok
        ? simitRes.value.body.data
        : null;
    const bogotaData =
      bogotaRes.status === "fulfilled" && bogotaRes.value.ok
        ? bogotaRes.value.body.data
        : null;

    const simitFines = normalizeFines(simitData);
    const bogotaFines = normalizeFines(bogotaData);

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

    return {
      hasFines: combinedFines.length > 0,
      totalFines: combinedFines.length,
      totalAmount,
      fines: combinedFines,
      lastCheckedAt: new Date().toISOString(),
    };
  }

  async getVehicleTaxes(plate: string): Promise<VerifikTaxesRecord> {
    const cleanPlate = plate.trim().toUpperCase();
    const fetchResult = await executeVerifikFetch(
      this.configService,
      this.logger,
      "/v2/co/bogota/vehicle/tax",
      { plate: cleanPlate },
    );

    if (!fetchResult.ok) {
      return {
        plate: cleanPlate,
        status: "AL_DIA",
        pendingYears: [],
        totalAmount: 0,
        message: "Sin novedades registradas en impuestos distritales.",
      };
    }

    return normalizeTaxes(fetchResult.body.data, cleanPlate);
  }

  async getVehicleValuation(plate: string): Promise<VerifikValuationRecord> {
    const cleanPlate = plate.trim().toUpperCase();
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
        { plate: cleanPlate },
      ),
    ]);

    const rawF =
      fasecoldaRes.status === "fulfilled" && fasecoldaRes.value.ok
        ? fasecoldaRes.value.body.data
        : null;
    const rawS =
      sibgaRes.status === "fulfilled" && sibgaRes.value.ok
        ? sibgaRes.value.body.data
        : null;

    return normalizeValuation(rawF, rawS, cleanPlate);
  }

  async getVehicleSinister(plate: string): Promise<VerifikSinisterRecord> {
    const cleanPlate = plate.trim().toUpperCase();
    const fetchResult = await executeVerifikFetch(
      this.configService,
      this.logger,
      "/v2/co/fasecolda/sinister",
      { plate: cleanPlate },
    );

    if (!fetchResult.ok) {
      return {
        plate: cleanPlate,
        hasSinister: false,
        sinisterCount: 0,
        records: [],
        status: "LIMPIO",
      };
    }

    return normalizeSinister(fetchResult.body.data, cleanPlate);
  }

  async getDriverLicense(
    documentType: string,
    documentNumber: string,
  ): Promise<VerifikDriverLicenseRecord> {
    const cleanDocType = documentType.trim().toUpperCase();
    const cleanDocNumber = documentNumber.replace(/\D/g, "");

    const fetchResult = await executeVerifikFetch(
      this.configService,
      this.logger,
      "/v2/co/runt/conductor",
      { documentType: cleanDocType, documentNumber: cleanDocNumber },
    );

    if (!fetchResult.ok || !fetchResult.body.data) {
      return {
        documentNumber: cleanDocNumber,
        documentType: cleanDocType,
        status: "NO_REGISTRA",
        categories: [],
        expeditionDate: null,
        expiryDate: null,
      };
    }

    const d = fetchResult.body.data as Record<string, unknown>;
    let rawCats: unknown[] = [];
    if (Array.isArray(d.categorias)) {
      rawCats = d.categorias;
    } else if (Array.isArray(d.categories)) {
      rawCats = d.categories;
    }
    const categories = rawCats.map((c: unknown) => {
      const cObj = (c && typeof c === "object" ? c : {}) as Record<
        string,
        unknown
      >;
      return {
        category: safeStr(cObj.categoria ?? cObj.category, ""),
        validUntil:
          typeof cObj.fechaVencimiento === "string"
            ? cObj.fechaVencimiento
            : null,
        status: safeStr(cObj.estado, ""),
      };
    });

    const licenseStatus = safeStr(d.estado, "NO_REGISTRA").toUpperCase();
    return {
      documentNumber: cleanDocNumber,
      documentType: cleanDocType,
      status:
        (licenseStatus as VerifikDriverLicenseRecord["status"]) ||
        "NO_REGISTRA",
      categories,
      expeditionDate:
        typeof d.fechaExpedicion === "string" ? d.fechaExpedicion : null,
      expiryDate:
        typeof d.fechaVencimiento === "string" ? d.fechaVencimiento : null,
    };
  }

  async getFullVehicleDiagnostic(
    queryKeyOrOptions:
      | string
      | {
          plate: string;
          vin?: string;
          fallbackRecord?: Partial<VerifikRuntVehicleRecord>;
        },
    userDocHolder?: string,
    userDocType?: string,
    existingFallback?: Partial<VerifikRuntVehicleRecord>,
  ): Promise<VerifikFullDiagnosticRecord> {
    let plate = "";
    let vin = "";
    let fallbackRecord: Partial<VerifikRuntVehicleRecord> | undefined =
      existingFallback;

    if (typeof queryKeyOrOptions === "object" && queryKeyOrOptions !== null) {
      plate = (queryKeyOrOptions.plate || "").trim().toUpperCase();
      vin = (queryKeyOrOptions.vin || "").trim().toUpperCase();
      fallbackRecord = queryKeyOrOptions.fallbackRecord || fallbackRecord;
    } else {
      const clean = String(queryKeyOrOptions || "").trim().toUpperCase();
      const isVin = clean.length > 8 && /[A-HJ-NPR-Z0-9]{11,17}/i.test(clean);
      if (isVin) {
        vin = clean;
      } else {
        plate = clean;
      }
    }

    let vehicleResult: VerifikRuntLookupResult | null = null;

    // Strategy 1: If plate is known and owner document is provided, query official RUNT with document
    if (plate && userDocHolder) {
      const docResult = await this.verifyRuntVehicle(
        userDocType ?? "CC",
        userDocHolder,
        plate,
      );
      if (docResult.ok) {
        vehicleResult = docResult;
      }
    }

    // Strategy 2: If not resolved yet and plate is known, query by plate
    if (!vehicleResult?.ok && plate) {
      const plateResult = await this.verifyRuntVehicleByPlate(plate);
      if (plateResult.ok) {
        vehicleResult = plateResult;
      } else if (!vehicleResult) {
        vehicleResult = plateResult;
      }
    }

    // Strategy 3: If not resolved yet and valid VIN is provided, query by VIN
    if (!vehicleResult?.ok && vin && vin.length >= 11 && vin.length <= 17) {
      const vinResult = await this.verifyRuntVehicleByVin(vin);
      if (vinResult.ok) {
        vehicleResult = vinResult;
        if (!plate && vinResult.record.plate) {
          plate = vinResult.record.plate;
        }
      } else if (!vehicleResult) {
        vehicleResult = vinResult;
      }
    }

    // Determine plate from result if not previously determined
    if (!plate && vehicleResult?.ok && vehicleResult.record.plate) {
      plate = vehicleResult.record.plate;
    }

    let vehicle: VerifikRuntVehicleRecord;
    let runtUnavailable = false;
    let runtMessage: string | undefined;

    if (vehicleResult?.ok) {
      vehicle = vehicleResult.record;
      plate = vehicle.plate || plate;
    } else {
      runtUnavailable = true;
      runtMessage =
        vehicleResult?.message ||
        "La verificación con el RUNT no está disponible en este momento.";

      // If plate is available, apply graceful degradation with fallback record
      if (plate) {
        this.logger.warn(
          `Verifik RUNT lookup failed for plate ${plate}: ${runtMessage}. Fallback record used to continue diagnostics.`,
        );
        vehicle = {
          plate,
          brand: fallbackRecord?.brand ?? null,
          modelLine: fallbackRecord?.modelLine ?? null,
          year: fallbackRecord?.year ?? null,
          displacementCc: fallbackRecord?.displacementCc ?? null,
          color: fallbackRecord?.color ?? null,
          serviceType: fallbackRecord?.serviceType ?? "PARTICULAR",
          classType: fallbackRecord?.classType ?? "MOTOCICLETA",
          engineNumber: fallbackRecord?.engineNumber ?? null,
          vinOrChassis: fallbackRecord?.vinOrChassis ?? (vin || null),
          soat: fallbackRecord?.soat ?? null,
          rtm: fallbackRecord?.rtm ?? null,
          verifikId: null,
        };
      } else {
        throw new BadRequestException(
          `No fue posible consultar el vehículo en Verifik RUNT: ${runtMessage}`,
        );
      }
    }

    const [fines, taxes, valuation, sinister, license] = await Promise.all([
      this.getVehicleFines(plate).catch(() => normalizeFines(null)),
      this.getVehicleTaxes(plate).catch(() => normalizeTaxes(null, plate)),
      this.getVehicleValuation(plate).catch(() =>
        normalizeValuation(null, null, plate),
      ),
      this.getVehicleSinister(plate).catch(() =>
        normalizeSinister(null, plate),
      ),
      userDocHolder
        ? this.getDriverLicense(userDocType ?? "CC", userDocHolder).catch(
            () => null,
          )
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
      return {
        ok: false,
        reason: "invalid_input",
        message:
          "Los datos del documento no cumplen el formato requerido. Verifica el número y la fecha de expedición.",
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
        `Verifik error ${response.status} on ${path}: ${sanitizeForLog(
          typeof body.message === "string" ? body.message : "unknown",
        )}`,
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
      this.logger.warn(`Verifik RUNT 409 conflict/unavailable on ${path}`);
      return {
        ok: false,
        reason: "unavailable",
        message:
          "La plataforma oficial del RUNT no está disponible o se encuentra en mantenimiento temporal.",
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

    const rawError =
      typeof body.message === "string" && body.message.trim()
        ? body.message.trim()
        : typeof (body as Record<string, unknown>).error === "string" &&
          (body as Record<string, unknown>).error
        ? String((body as Record<string, unknown>).error).trim()
        : null;

    if (!response.ok || !body.data) {
      this.logger.error(
        `Verifik RUNT error ${response.status} on ${path}: ${sanitizeForLog(
          rawError || "unknown",
        )}`,
      );
      return {
        ok: false,
        reason:
          response.status === 409 || response.status >= 500
            ? "unavailable"
            : "invalid_input",
        message:
          rawError ||
          (response.status >= 500
            ? "La verificación con el RUNT no está disponible en este momento por mantenimiento de la fuente oficial."
            : "La verificación con el RUNT no está disponible en este momento."),
      };
    }

    const payloadData = Array.isArray(body.data)
      ? (body.data[0] as Record<string, unknown>)
      : (body.data as Record<string, unknown>);

    return {
      ok: true,
      record: normalizeRuntVehicle(
        payloadData,
        body.id,
        params.plate || "",
      ),
    };
  }
}
