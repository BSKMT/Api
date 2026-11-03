import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  VerifikService,
  type VerifikDocumentType,
  type VerifikLookupResult,
} from "../verifik/verifik.service";
import { maskDocument } from "../common/utils/log-redact.util";
import {
  DOCUMENT_NUMBER_PATTERN,
  REQUIRES_EXPEDITION_DATE,
  mapDocumentType,
} from "./identity-verification-matcher";
import { toVerifikDate } from "./identity-verification-checks";
import type { KvCacheService } from "../kv/kv-cache.service";

export class IdentityAttemptThrottle {
  private readonly logger = new Logger(IdentityAttemptThrottle.name);
  private readonly windowMs = 10 * 60 * 1000;
  private readonly maxAttempts = 3;
  private readonly attempts = new Map<string, number[]>();

  constructor(private readonly kvCache?: KvCacheService) {}

  async enforce(userId: string): Promise<void> {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    let timestamps: number[] = [];

    if (this.kvCache?.isAvailable()) {
      try {
        const cached = await this.kvCache.get<number[]>(
          `throttle:id:${userId}`,
          true,
        );
        if (Array.isArray(cached)) {
          timestamps = cached.filter(
            (t) => typeof t === "number" && t > cutoff,
          );
        }
      } catch {
        timestamps = (this.attempts.get(userId) ?? []).filter(
          (t) => t > cutoff,
        );
      }
    } else {
      timestamps = (this.attempts.get(userId) ?? []).filter((t) => t > cutoff);
    }

    if (timestamps.length >= this.maxAttempts) {
      this.logger.warn(
        `Identity-verification throttle: user ${userId} exceeded ${this.maxAttempts} attempts in 10 min`,
      );
      throw new HttpException(
        "Has superado el limite de intentos de verificacion. Espera 10 minutos e intenta de nuevo.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async record(userId: string): Promise<void> {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    let timestamps = (this.attempts.get(userId) ?? []).filter(
      (t) => t > cutoff,
    );

    if (this.kvCache?.isAvailable()) {
      try {
        const cached = await this.kvCache.get<number[]>(
          `throttle:id:${userId}`,
          true,
        );
        if (Array.isArray(cached)) {
          const merged = new Set<number>([
            ...timestamps,
            ...cached.filter((t) => typeof t === "number" && t > cutoff),
          ]);
          timestamps = Array.from(merged).sort((a, b) => a - b);
        }
      } catch {
        // Fallback local si falla la lectura previa de KV
      }
    }

    timestamps.push(now);
    this.attempts.set(userId, timestamps);

    if (this.kvCache?.isAvailable()) {
      try {
        const ttlSec = Math.ceil(this.windowMs / 1000);
        await this.kvCache.set(
          `throttle:id:${userId}`,
          timestamps,
          ttlSec,
          true,
        );
      } catch {
        // Fallback local silencioso
      }
    }
  }
}

export function extractAndValidateDocument(
  personal: Record<string, unknown>,
  dto?:
    | {
        documentType?: string;
        documentNumber?: string;
        expeditionDate?: string;
      }
    | string,
): {
  verifikType: VerifikDocumentType;
  documentNumber: string;
  verifikExpeditionDate: string | null;
} {
  const dtoObj =
    typeof dto === "string" ? { expeditionDate: dto } : (dto ?? {});
  const rawType = (
    dtoObj.documentType?.trim() ||
    (typeof personal.tipoDocumento === "string" ? personal.tipoDocumento : "")
  ).trim();
  const rawNumber = (
    dtoObj.documentNumber?.trim() ||
    (typeof personal.numeroDocumento === "string"
      ? personal.numeroDocumento
      : "")
  ).trim();

  const verifikType = mapDocumentType(rawType);
  if (!verifikType) {
    throw new BadRequestException(
      "El tipo de documento seleccionado no admite verificación automática (CC, CE, PPT o PEP). Contacta al equipo BSK.",
    );
  }

  const documentNumber =
    verifikType === "CC" ||
    verifikType === "NIT" ||
    verifikType === "TI" ||
    verifikType === "PEP" ||
    verifikType === "RC"
      ? rawNumber.replace(/\D/g, "")
      : rawNumber.toUpperCase().replace(/[^A-Z0-9-]/g, "");
  if (!DOCUMENT_NUMBER_PATTERN[verifikType].test(documentNumber)) {
    throw new BadRequestException(
      verifikType === "PEP"
        ? "El número de PEP debe tener exactamente 15 dígitos."
        : "El número de documento no tiene un formato válido. Corrígelo e intenta de nuevo.",
    );
  }

  let verifikExpeditionDate: string | null = null;
  if (REQUIRES_EXPEDITION_DATE[verifikType]) {
    verifikExpeditionDate = toVerifikDate(dtoObj.expeditionDate);
    if (!verifikExpeditionDate) {
      throw new BadRequestException(
        "Debes ingresar la fecha de expedición de tu documento de extranjería (DD/MM/AAAA).",
      );
    }
  }

  return { verifikType, documentNumber, verifikExpeditionDate };
}

export function handleLookupFailure(
  lookup: Extract<VerifikLookupResult, { ok: false }>,
  userId: string,
  documentNumber: string,
  logger: Logger,
): never {
  if (lookup.reason === "not_found" || lookup.reason === "invalid_input") {
    throw new BadRequestException(lookup.message);
  }
  logger.warn(
    `Verifik lookup failed (${lookup.reason}) for user ${userId} doc ${maskDocument(documentNumber)}`,
  );
  throw new ServiceUnavailableException(lookup.message);
}

export async function callVerifikService(
  verifikService: VerifikService,
  verifikType: VerifikDocumentType,
  documentNumber: string,
  expeditionDate: string | null,
): Promise<Awaited<ReturnType<VerifikService["verifyCedulaPremium"]>>> {
  switch (verifikType) {
    case "CC":
      return verifikService.verifyCedulaPremium(documentNumber);
    case "CE":
      return verifikService.verifyCe(documentNumber, expeditionDate ?? "");
    case "PPT":
      return verifikService.verifyPpt(documentNumber, expeditionDate ?? "");
    case "PEP":
      return verifikService.verifyPep(documentNumber, expeditionDate ?? "");
    default:
      return {
        ok: false,
        reason: "invalid_input",
        message: `El tipo de documento '${verifikType}' no es admitido para verificación automática de identidad.`,
      };
  }
}
