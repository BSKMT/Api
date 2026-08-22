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
  data?: VerifikRawData;
  signature?: { message?: unknown; dateTime?: unknown };
  id?: unknown;
  message?: unknown;
  code?: unknown;
}

/**
 * VerifikService — typed HTTP client for the Verifik v2 Colombia
 * identity-verification API (https://api.verifik.co).
 *
 * Endpoints used (per the Verifik documentation):
 *
 *  - CC  → GET /v2/co/cedula/premium
 *          Full civil-registry record: names, date of birth, gender,
 *          alive status and expedition data. Only `documentNumber`
 *          required (the issue date is resolved server-side).
 *  - CE  → GET /v2/co/foreigner-id/ce   (Migración Colombia)
 *  - PPT → GET /v2/co/foreigner-id/ppt  (Migración Colombia)
 *  - PEP → GET /v2/co/foreigner-id/pep  (Migración Colombia)
 *          The three foreigner routes require `documentNumber` plus the
 *          document `expeditionDate` in DD/MM/YYYY and return the
 *          immigration status (e.g. VIGENTE) alongside the names.
 *
 * Security (OWASP 2025):
 *
 *  - A04 (Cryptographic Failures): the bearer token lives only in the
 *    server environment; it is never logged and never returned to any
 *    client. Requests to Verifik always go over HTTPS.
 *  - A05 (Injection): every parameter is strictly validated before it
 *    is placed on the query string (digits-only document numbers, a
 *    DD/MM/YYYY expedition date) and encoded via URLSearchParams.
 *  - A09 (Security Logging): failures are logged with sanitized
 *    messages and masked document numbers — never full personal data.
 *  - A10 (Mishandling of Exceptional Conditions): every outbound call
 *    is wrapped with an AbortController timeout and mapped to a typed
 *    result instead of throwing raw upstream errors to callers.
 */
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
   * Verifies a Colombian *Cédula de Ciudadanía* (CC) via the premium
   * route, which resolves the issue date server-side and returns the
   * full identity record (names, date of birth, gender, alive status).
   *
   * @param documentNumber CC number, 5–10 digits (digits only).
   */
  async verifyCedulaPremium(
    documentNumber: string,
  ): Promise<VerifikLookupResult> {
    return this.get("/v2/co/cedula/premium", { documentNumber });
  }

  /**
   * Verifies a *Cédula de Extranjería* (CE) against Migración Colombia.
   *
   * @param documentNumber CE number, digits only (usually 6–7 digits).
   * @param expeditionDate Issue date on the document, `DD/MM/YYYY`.
   */
  async verifyCe(
    documentNumber: string,
    expeditionDate: string,
  ): Promise<VerifikLookupResult> {
    return this.get("/v2/co/foreigner-id/ce", {
      documentNumber,
      expeditionDate,
    });
  }

  /**
   * Verifies a *Permiso de Protección Temporal* (PPT) immigration
   * status against Migración Colombia.
   *
   * @param documentNumber PPT number, digits only (usually ≤ 7 digits).
   * @param expeditionDate Issue date on the document, `DD/MM/YYYY`.
   */
  async verifyPpt(
    documentNumber: string,
    expeditionDate: string,
  ): Promise<VerifikLookupResult> {
    return this.get("/v2/co/foreigner-id/ppt", {
      documentNumber,
      expeditionDate,
    });
  }

  /**
   * Verifies a *Permiso Especial de Permanencia* (PEP — immigration
   * permit) against Migración Colombia. PEP numbers are always 15 digits.
   *
   * @param documentNumber PEP number, exactly 15 digits.
   * @param expeditionDate Issue date on the document, `DD/MM/YYYY`.
   */
  async verifyPep(
    documentNumber: string,
    expeditionDate: string,
  ): Promise<VerifikLookupResult> {
    return this.get("/v2/co/foreigner-id/pep", {
      documentNumber,
      expeditionDate,
    });
  }

  // ── Internals ────────────────────────────────────────────────────────

  private async get(
    path: string,
    params: Record<string, string>,
  ): Promise<VerifikLookupResult> {
    const token = this.configService.get<string>("VERIFIK_API_TOKEN");
    if (!token) {
      return {
        ok: false,
        reason: "unavailable",
        message: "La verificacion de identidad no esta disponible.",
      };
    }

    const baseUrl = (
      this.configService.get<string>("VERIFIK_API_URL") ??
      "https://api.verifik.co"
    ).replace(/\/+$/, "");
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
          message: "La verificacion de identidad no esta disponible.",
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
          message: "La verificacion de identidad no esta disponible.",
        };
      }

      if (response.status === 404) {
        return {
          ok: false,
          reason: "not_found",
          message:
            "No encontramos registros para el documento. Verifica el numero y la fecha de expedicion.",
        };
      }

      if (response.status === 409) {
        // Validation failure before the upstream lookup ran.
        return {
          ok: false,
          reason: "invalid_input",
          message:
            "Los datos del documento no cumplen el formato requerido. Verifica el numero y la fecha de expedicion.",
        };
      }

      if (response.status === 429) {
        this.logger.warn(`Verifik rate limit hit on ${path}`);
        return {
          ok: false,
          reason: "unavailable",
          message:
            "El servicio de verificacion esta saturado. Intenta de nuevo en unos minutos.",
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
          message: "La verificacion de identidad no esta disponible.",
        };
      }

      return { ok: true, record: this.normalize(body.data, body.id) };
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
        message: "La verificacion de identidad no esta disponible.",
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Maps a raw Verifik `data` payload into the normalized record,
   * tolerating absent fields (each document type returns a different
   * subset) and rejecting values with unexpected types.
   */
  private normalize(data: VerifikRawData, id: unknown): VerifikIdentityRecord {
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
