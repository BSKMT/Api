import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { EnvironmentConfig } from "../config/config.interface";
import { sanitizeForLog } from "../common/utils/log-redact.util";
import type {
  VerifikLookupResult,
  VerifikRuntLookupResult,
} from "./verifik.interfaces";
import { normalizeRuntVehicle } from "./verifik-runt.helpers";
import { normalizeIdentity } from "./verifik-identity.helpers";
import { executeVerifikFetch } from "./verifik-fetch.helper";

export type {
  VerifikIdentityRecord,
  VerifikLookupResult,
  VerifikSoatRecord,
  VerifikRtmRecord,
  VerifikRuntVehicleRecord,
  VerifikRuntLookupResult,
  VerifikDocumentType,
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
