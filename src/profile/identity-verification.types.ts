import type { VerifikDocumentType } from "../verifik/verifik.service";

export type CheckOutcome =
  | "match"
  | "mismatch"
  | "auto_filled"
  | "not_provided"
  | "not_comparable"
  | "not_applicable";

export interface IdentityCheckResult {
  names: CheckOutcome;
  birthDate: CheckOutcome;
  gender: CheckOutcome;
  documentStatus: CheckOutcome;
}

export interface IdentityVerificationStatus {
  identityVerified: boolean;
  verifiedAt: string | null;
  document: {
    type: string;
    number: string;
    verifikType: VerifikDocumentType | null;
    requiresExpeditionDate: boolean;
  };
  verification: {
    documentType: string;
    documentNumber: string;
    fullName: string;
    dateOfBirth: string | null;
    gender: string | null;
    documentStatus: string | null;
    verifiedAt: string;
  } | null;
}

export interface IdentityVerifyResult {
  verified: boolean;
  message: string;
  checks: IdentityCheckResult | null;
  autoFilledFields: string[];
  officialData: {
    fullName: string;
    dateOfBirth: string | null;
    gender: string | null;
    documentStatus: string | null;
  } | null;
}
