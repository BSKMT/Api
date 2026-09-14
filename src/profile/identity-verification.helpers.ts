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

export class IdentityAttemptThrottle {
  private readonly logger = new Logger(IdentityAttemptThrottle.name);
  private readonly windowMs = 10 * 60 * 1000;
  private readonly maxAttempts = 3;
  private readonly attempts = new Map<string, number[]>();

  enforce(userId: string): void {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const timestamps = (this.attempts.get(userId) ?? []).filter(
      (t) => t > cutoff,
    );
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

  record(userId: string): void {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const timestamps = (this.attempts.get(userId) ?? []).filter(
      (t) => t > cutoff,
    );
    timestamps.push(now);
    this.attempts.set(userId, timestamps);
  }
}

export function extractAndValidateDocument(
  personal: Record<string, unknown>,
  expeditionDate?: string,
): {
  verifikType: VerifikDocumentType;
  documentNumber: string;
  verifikExpeditionDate: string | null;
} {
  const rawType =
    typeof personal.tipoDocumento === "string" ? personal.tipoDocumento : "";
  const rawNumber =
    typeof personal.numeroDocumento === "string"
      ? personal.numeroDocumento
      : "";

  const verifikType = mapDocumentType(rawType);
  if (!verifikType) {
    throw new BadRequestException(
      "El tipo de documento registrado no admite verificacion automatica. Contacta al equipo BSK.",
    );
  }

  const documentNumber = rawNumber.replace(/\D/g, "");
  if (!DOCUMENT_NUMBER_PATTERN[verifikType].test(documentNumber)) {
    throw new BadRequestException(
      verifikType === "PEP"
        ? "El numero de PEP debe tener exactamente 15 digitos."
        : "El numero de documento no tiene un formato valido. Corrigelo en tu perfil e intenta de nuevo.",
    );
  }

  let verifikExpeditionDate: string | null = null;
  if (REQUIRES_EXPEDITION_DATE[verifikType]) {
    verifikExpeditionDate = toVerifikDate(expeditionDate);
    if (!verifikExpeditionDate) {
      throw new BadRequestException(
        "Debes ingresar la fecha de expedicion de tu documento (DD/MM/AAAA).",
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
  }
}
