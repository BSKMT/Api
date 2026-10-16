import { BadRequestException } from "@nestjs/common";
import { parseCheckInInput } from "../../events/events-checkin.helpers";

const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;

export function buildCheckInOrClauses(codeOrQr: string): Record<string, unknown>[] {
  if (!codeOrQr || typeof codeOrQr !== "string") {
    throw new BadRequestException("Código o lectura de QR requerida.");
  }

  const parsed = parseCheckInInput(codeOrQr);
  const candidateCode = parsed.checkInCode;
  const candidateRegId = parsed.registrationId;

  const orClauses: Record<string, unknown>[] = [];
  if (candidateCode) {
    orClauses.push({ checkInCode: candidateCode });
  }
  if (candidateRegId && OBJECT_ID_REGEX.exec(candidateRegId)) {
    orClauses.push({ _id: candidateRegId });
  }
  if (candidateCode && OBJECT_ID_REGEX.exec(candidateCode)) {
    orClauses.push({ _id: candidateCode });
  }

  if (orClauses.length === 0) {
    throw new BadRequestException("Formato de código o QR no válido.");
  }

  return orClauses;
}

export function deriveGestionAttendee(
  u: Record<string, unknown> | null | undefined,
  fallback = "Asistente",
): { name: string; email?: string; phone: string } {
  const rawProfile = u?.profile as
    Record<string, Record<string, string>> | undefined;
  const personal = rawProfile?.["datos-personales"];
  const contact = rawProfile?.["contacto"];
  const primerNombre =
    typeof personal?.primerNombre === "string" ? personal.primerNombre : "";
  const primerApellido =
    typeof personal?.primerApellido === "string" ? personal.primerApellido : "";
  const fullName = `${primerNombre} ${primerApellido}`.trim();
  const name = fullName || (u?.email as string) || fallback;
  const phone =
    typeof contact?.celular === "string" ? contact.celular : "No registrado";

  return {
    name,
    email: u?.email as string | undefined,
    phone,
  };
}

export function getGestionActorName(user: {
  contractorInfo?: { nombres: string; apellidos: string } | null;
  email?: string;
  userId: string;
}): string {
  if (user.contractorInfo) {
    return `${user.contractorInfo.nombres} ${user.contractorInfo.apellidos}`;
  }
  return user.email || user.userId;
}
