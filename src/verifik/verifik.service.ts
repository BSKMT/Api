import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { EnvironmentConfig } from "../config/config.interface";
import { sanitizeForLog } from "../common/utils/log-redact.util";

/**
 * Normalized identity record returned by any Verifik Colombia endpoint.
 * `null` means the upstream source did not provide the field for the
 * queried document type (e.g. CE/PEP/PPT never return `dateOfBirth`).
 */
export interface VerifikIdentityRecord {
  documentType: string;
  documentNumber: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  /** Ordered name tokens as published by the official source. */
  arrayName: string[];
  dateOfBirth: string | null;
  /** HOMBRE | MUJER (only returned by the CC premium route). */
  gender: string | null;
  isAlive: boolean | null;
  expeditionDate: string | null;
  expeditionPlace: {
    municipio: string | null;
    departamento: string | null;
  } | null;
  /** Immigration status for foreigner documents: VIGENTE | VENCIDO | … */
  status: string | null;
  expirationDate: string | null;
  /** Verifik request id (useful for support / billing disputes). */
  verifikId: string | null;
}

/** Discriminated result of a Verifik lookup. */
export type VerifikLookupResult =
  | { ok: true; record: VerifikIdentityRecord }
  | {
      ok: false;
      reason: "not_found" | "invalid_input" | "unauthorized" | "unavailable";
      message: string;
    };

/** Official SOAT record retrieved from RUNT via Verifik. */
export interface VerifikSoatRecord {
  status: string | null;
  policyNumber: string | null;
  insuranceCompany: string | null;
  startDate: string | null;
  expiryDate: string | null;
}

/** Official Revisión Técnico-Mecánica (RTM) record from RUNT via Verifik. */
export interface VerifikRtmRecord {
  status: string | null;
  certificateNumber: string | null;
  cdaName: string | null;
  expeditionDate: string | null;
  expiryDate: string | null;
}

/** Normalized RUNT vehicle record from Verifik. */
export interface VerifikRuntVehicleRecord {
  plate: string;
  brand: string | null;
  modelLine: string | null;
  year: number | null;
  displacementCc: number | null;
  color: string | null;
  serviceType: string | null;
  classType: string | null;
  engineNumber: string | null;
  vinOrChassis: string | null;
  soat: VerifikSoatRecord | null;
  rtm: VerifikRtmRecord | null;
  verifikId: string | null;
}

export type VerifikRuntLookupResult =
  | { ok: true; record: VerifikRuntVehicleRecord }
  | {
      ok: false;
      reason: "not_found" | "invalid_input" | "unauthorized" | "unavailable";
      message: string;
    };

/** Supported Colombian document types on the Verifik v2 API. */
export type VerifikDocumentType = "CC" | "CE" | "PPT" | "PEP";

interface VerifikRawData {
  documentType?: unknown;
  documentNumber?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  fullName?: unknown;
  arrayName?: unknown;
  dateOfBirth?: unknown;
  gender?: unknown;
  isAlive?: unknown;
  expeditionDate?: unknown;
  expeditionPlace?: unknown;
  status?: unknown;
  expirationDate?: unknown;
}

interface VerifikRawResponse {
  data?: unknown;
  signature?: { message?: unknown; dateTime?: unknown };
  id?: unknown;
  message?: unknown;
  code?: unknown;
}

function normalizeRuntDate(val: unknown): string | null {
  if (typeof val !== "string" || !val.trim()) {
    return null;
  }
  const s = val.trim();
  const ddmmyyyyMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (ddmmyyyyMatch) {
    const [, d, m, y] = ddmmyyyyMatch;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return s;
}

function extractFirstObject(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  if (Array.isArray(raw)) {
    const first = raw[0];
    return typeof first === "object" && first !== null
      ? (first as Record<string, unknown>)
      : null;
  }
  return typeof raw === "object" ? (raw as Record<string, unknown>) : null;
}

function extractSoat(raw: unknown): VerifikSoatRecord | null {
  const item = extractFirstObject(raw);
  if (!item) return null;

  return {
    status: (item.estado ?? item.status ?? item.estadoPoliza ?? null) as
      | string
      | null,
    policyNumber: (item.numeroPoliza ??
      item.policyNumber ??
      item.numero ??
      null) as string | null,
    insuranceCompany: (item.entidadAseguradora ??
      item.aseguradora ??
      item.insuranceCompany ??
      null) as string | null,
    startDate: normalizeRuntDate(
      item.fechaVigenciaInicio ?? item.fechaInicio ?? item.startDate,
    ),
    expiryDate: normalizeRuntDate(
      item.fechaVigenciaFin ?? item.fechaVencimiento ?? item.expiryDate,
    ),
  };
}

function extractRtm(raw: unknown): VerifikRtmRecord | null {
  const item = extractFirstObject(raw);
  if (!item) return null;

  return {
    status: (item.estado ?? item.status ?? item.estadoCertificado ?? null) as
      | string
      | null,
    certificateNumber: (item.numeroCertificado ??
      item.certificateNumber ??
      item.control ??
      null) as string | null,
    cdaName: (item.cda ??
      item.centroDiagnostico ??
      item.cdaName ??
      item.nombreCda ??
      null) as string | null,
    expeditionDate: normalizeRuntDate(
      item.fechaExpedicion ??
        item.fechaExpedicionCertificado ??
        item.expeditionDate,
    ),
    expiryDate: normalizeRuntDate(
      item.fechaVigenciaFin ?? item.fechaVencimiento ?? item.expiryDate,
    ),
  };
}

function normalizeRuntVehicle(
  data: Record<string, unknown>,
  id: unknown,
  fallbackPlate: string,
): VerifikRuntVehicleRecord {
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? v.trim() : null;

  const num = (v: unknown): number | null => {
    if (typeof v === "number" && !Number.isNaN(v)) return v;
    if (typeof v === "string") {
      const parsed = Number(v.replace(/\D/g, ""));
      return !Number.isNaN(parsed) && parsed > 0 ? parsed : null;
    }
    return null;
  };

  const plate = str(data.plate) ?? str(data.placa) ?? fallbackPlate;
  const brand = str(data.marca) ?? str(data.brand);
  const modelLine = str(data.linea) ?? str(data.modelLine) ?? str(data.line);
  const year = num(data.modelo) ?? num(data.year);
  const displacementCc = num(data.cilindraje) ?? num(data.displacementCc);
  const color = str(data.color);
  const serviceType = str(data.servicio) ?? str(data.serviceType);
  const classType = str(data.clase) ?? str(data.classType);
  const engineNumber = str(data.numeroMotor) ?? str(data.engineNumber);
  const vinOrChassis =
    str(data.numeroChasis) ?? str(data.vin) ?? str(data.chasis);

  const rawSoat = data.soat ?? data.polizaSoat;
  const rawRtm = data.tecnomecanica ?? data.rtm ?? data.revisionTecnicomecanica;

  return {
    plate,
    brand,
    modelLine,
    year,
    displacementCc,
    color,
    serviceType,
    classType,
    engineNumber,
    vinOrChassis,
    soat: extractSoat(rawSoat),
    rtm: extractRtm(rawRtm),
    verifikId: str(id),
  };
}

@Injectable()
export class VerifikService {
  private readonly logger = new Logger(VerifikService.name);

  constructor(
    private readonly configService: ConfigService<EnvironmentConfig>,
  ) {}

  /** Whether the Verifik token is configured (feature flag). */
  isConfigured(): boolean {
    return Boolean(this.configService.get<string>("VERIFIK_API_TOKEN"));
  }

  /**
   * Verifies a Colombian Cédula de Ciudadanía (CC) via the premium route.
   */
  async verifyCedulaPremium(
    documentNumber: string,
  ): Promise<VerifikLookupResult> {
    return this.getIdentity("/v2/co/cedula/premium", { documentNumber });
  }

  /**
   * Verifies a Cédula de Extranjería (CE) against Migración Colombia.
   */
  async verifyCe(
    documentNumber: string,
    expeditionDate: string,
  ): Promise<VerifikLookupResult> {
    return this.getIdentity("/v2/co/foreigner-id/ce", {
      documentNumber,
      expeditionDate,
    });
  }

  /**
   * Verifies a Permiso de Protección Temporal (PPT) against Migración Colombia.
   */
  async verifyPpt(
    documentNumber: string,
    expeditionDate: string,
  ): Promise<VerifikLookupResult> {
    return this.getIdentity("/v2/co/foreigner-id/ppt", {
      documentNumber,
      expeditionDate,
    });
  }

  /**
   * Verifies a Permiso Especial de Permanencia (PEP) against Migración Colombia.
   */
  async verifyPep(
    documentNumber: string,
    expeditionDate: string,
  ): Promise<VerifikLookupResult> {
    return this.getIdentity("/v2/co/foreigner-id/pep", {
      documentNumber,
      expeditionDate,
    });
  }

  /**
   * Verifies vehicle and official SOAT & RTM documentation against RUNT via Verifik.
   *
   * @param documentType   CC | CE | NIT | etc.
   * @param documentNumber Document number of registered owner
   * @param plate          Vehicle plate (e.g. ABC12D)
   */
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

  // ── Internals ────────────────────────────────────────────────────────

  private async executeFetch(
    path: string,
    params: Record<string, string>,
  ): Promise<
    | { ok: true; response: Response; body: VerifikRawResponse }
    | {
        ok: false;
        reason: "unavailable" | "unauthorized" | "not_found" | "invalid_input";
        message: string;
      }
  > {
    const token = this.configService.get<string>("VERIFIK_API_TOKEN");
    if (!token) {
      return {
        ok: false,
        reason: "unavailable",
        message: "El servicio de verificación Verifik no está configurado.",
      };
    }

    let baseUrl =
      this.configService.get<string>("VERIFIK_API_URL") ??
      "https://api.verifik.co";
    while (baseUrl.endsWith("/")) {
      baseUrl = baseUrl.slice(0, -1);
    }
    const timeoutMs =
      this.configService.get<number>("VERIFIK_TIMEOUT_MS") ?? 15000;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const query = new URLSearchParams(params).toString();
      const response = await fetch(`${baseUrl}${path}?${query}`, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
        signal: controller.signal,
      });

      if (response.status === 401) {
        this.logger.error(
          `Verifik responded 401 for ${path} — check VERIFIK_API_TOKEN`,
        );
        return {
          ok: false,
          reason: "unauthorized",
          message: "El servicio de verificación no está disponible.",
        };
      }

      let body: VerifikRawResponse;
      try {
        body = (await response.json()) as VerifikRawResponse;
      } catch {
        this.logger.error(
          `Verifik returned a non-JSON body (${response.status}) for ${path}`,
        );
        return {
          ok: false,
          reason: "unavailable",
          message: "El servicio de verificación no está disponible.",
        };
      }

      return { ok: true, response, body };
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        this.logger.warn(`Verifik request to ${path} timed out`);
      } else {
        this.logger.error(
          `Verifik request to ${path} failed: ${sanitizeForLog(
            err instanceof Error ? err.message : String(err),
          )}`,
        );
      }
      return {
        ok: false,
        reason: "unavailable",
        message: "El servicio de verificación no está disponible.",
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async getIdentity(
    path: string,
    params: Record<string, string>,
  ): Promise<VerifikLookupResult> {
    const fetchResult = await this.executeFetch(path, params);
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
      record: this.normalizeIdentity(body.data, body.id),
    };
  }

  private async getRuntVehicle(
    path: string,
    params: Record<string, string>,
  ): Promise<VerifikRuntLookupResult> {
    const fetchResult = await this.executeFetch(path, params);
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

  private normalizeIdentity(
    data: VerifikRawData,
    id: unknown,
  ): VerifikIdentityRecord {
    const str = (v: unknown): string | null =>
      typeof v === "string" && v.trim() ? v.trim() : null;

    const expeditionPlace =
      data.expeditionPlace &&
      typeof data.expeditionPlace === "object" &&
      !Array.isArray(data.expeditionPlace)
        ? {
            municipio: str(
              (data.expeditionPlace as Record<string, unknown>).municipio,
            ),
            departamento: str(
              (data.expeditionPlace as Record<string, unknown>).departamento,
            ),
          }
        : null;

    const arrayName = Array.isArray(data.arrayName)
      ? data.arrayName.filter(
          (token): token is string =>
            typeof token === "string" && token.trim().length > 0,
        )
      : [];

    return {
      documentType: str(data.documentType) ?? "",
      documentNumber: str(data.documentNumber) ?? "",
      firstName: str(data.firstName),
      lastName: str(data.lastName),
      fullName: str(data.fullName),
      arrayName,
      dateOfBirth: str(data.dateOfBirth),
      gender: str(data.gender),
      isAlive: typeof data.isAlive === "boolean" ? data.isAlive : null,
      expeditionDate: str(data.expeditionDate),
      expeditionPlace:
        expeditionPlace?.municipio || expeditionPlace?.departamento
          ? expeditionPlace
          : null,
      status: str(data.status),
      expirationDate: str(data.expirationDate),
      verifikId: str(id),
    };
  }
}
