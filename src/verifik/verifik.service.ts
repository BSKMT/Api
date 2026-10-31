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

    return this.getRuntVehicle("/v2/co/runt/vehiculo", {
      documentType: cleanDocType,
      documentNumber: cleanDocNumber,
      plate: cleanPlate,
    });
  }

  async verifyRuntVehicleByVin(vin: string): Promise<VerifikRuntLookupResult> {
    const cleanVin = vin.trim().toUpperCase();
    return this.getRuntVehicle("/v2/co/runt/vehicle-by-vin", {
      vin: cleanVin,
    });
  }

  async verifyRuntVehicleByPlate(
    plate: string,
  ): Promise<VerifikRuntLookupResult> {
    const cleanPlate = plate.trim().toUpperCase();
    return this.getRuntVehicle("/v2/co/runt/vehicle-by-plate-only", {
      plate: cleanPlate,
    });
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
    vinOrPlate: string,
    userDocHolder?: string,
    userDocType?: string,
  ): Promise<VerifikFullDiagnosticRecord> {
    const clean = vinOrPlate.trim().toUpperCase();
    const isVin = clean.length > 8 && /[A-HJ-NPR-Z0-9]{11,17}/i.test(clean);

    let vehicleResult: VerifikRuntLookupResult;
    if (isVin) {
      vehicleResult = await this.verifyRuntVehicleByVin(clean);
    } else {
      vehicleResult = await this.verifyRuntVehicleByPlate(clean);
    }

    if (!vehicleResult.ok) {
      throw new BadRequestException(
        `No fue posible consultar el vehículo en Verifik RUNT: ${vehicleResult.message}`,
      );
    }

    const vehicle = vehicleResult.record;
    const plate = vehicle.plate;

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
      return {
        ok: false,
        reason: "invalid_input",
        message:
          "Los datos de la placa o documento no cumplen el formato requerido por el RUNT.",
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
        `Verifik RUNT error ${response.status} on ${path}: ${sanitizeForLog(
          typeof body.message === "string" ? body.message : "unknown",
        )}`,
      );
      return {
        ok: false,
        reason: "unavailable",
        message:
          "La verificación con el RUNT no está disponible en este momento.",
      };
    }

    return {
      ok: true,
      record: normalizeRuntVehicle(
        body.data as Record<string, unknown>,
        body.id,
        params.plate,
      ),
    };
  }
}
