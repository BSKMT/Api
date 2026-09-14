export interface VerifikIdentityRecord {
  documentType: string;
  documentNumber: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  arrayName: string[];
  dateOfBirth: string | null;
  gender: string | null;
  isAlive: boolean | null;
  expeditionDate: string | null;
  expeditionPlace: {
    municipio: string | null;
    departamento: string | null;
  } | null;
  status: string | null;
  expirationDate: string | null;
  verifikId: string | null;
}

export type VerifikLookupResult =
  | { ok: true; record: VerifikIdentityRecord }
  | {
      ok: false;
      reason: "not_found" | "invalid_input" | "unauthorized" | "unavailable";
      message: string;
    };

export interface VerifikSoatRecord {
  status: string | null;
  policyNumber: string | null;
  insuranceCompany: string | null;
  startDate: string | null;
  expiryDate: string | null;
}

export interface VerifikRtmRecord {
  status: string | null;
  certificateNumber: string | null;
  cdaName: string | null;
  expeditionDate: string | null;
  expiryDate: string | null;
}

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

export type VerifikDocumentType = "CC" | "CE" | "PPT" | "PEP";

export interface VerifikRawData {
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

export interface VerifikRawResponse {
  data?: unknown;
  signature?: { message?: unknown; dateTime?: unknown };
  id?: unknown;
  message?: unknown;
  code?: unknown;
}
