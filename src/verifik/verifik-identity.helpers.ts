import type {
  VerifikRawData,
  VerifikIdentityRecord,
} from "./verifik.interfaces";

export function normalizeIdentity(
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
