export const EVENT_TIER_REFERENCE_PREFIX: Record<string, string> = {
  "member-solo": "MEM-EVT",
  "member-companion": "MEMC-EVT",
  "non-member-solo": "NM-EVT",
  "non-member-companion": "NMC-EVT",
};

export const COURSE_TIER_REFERENCE_PREFIX: Record<string, string> = {
  "course-member-virtual": "CMV-CRS",
  "course-member-semipresencial": "CMS-CRS",
  "course-member-presencial": "CMP-CRS",
  "course-non-member": "CNM-CRS",
};

export const COURSE_TIERS = new Set([
  "course-member-virtual",
  "course-member-semipresencial",
  "course-member-presencial",
  "course-non-member",
]);

export const COMPANION_TIERS = new Set([
  "member-companion",
  "non-member-companion",
]);

export const ARPHA_TIERS = new Set([
  "arpha-tecnica",
  "arpha-emergencia",
  "arpha-juridica",
  "arpha-ruta",
]);

export const SHOP_TIERS = new Set(["shop"]);

export const ARPHA_TIER_PREFIX: Record<string, string> = {
  "arpha-tecnica": "ARPHA-TEC",
  "arpha-emergencia": "ARPHA-EMG",
  "arpha-juridica": "ARPHA-JUR",
  "arpha-ruta": "ARPHA-RUT",
};

export const ARPHA_TIER_LABEL: Record<string, string> = {
  "arpha-tecnica": "Asistencia Técnica",
  "arpha-emergencia": "Emergencia",
  "arpha-juridica": "Asistencia Jurídica",
  "arpha-ruta": "Asistencia en Ruta",
};

export const TERMINAL_STATUSES = new Set([
  "APPROVED",
  "REJECTED",
  "FAILED",
  "VOIDED",
]);

export const MEMBER_TIERS = new Set([
  "member-solo",
  "member-companion",
  "course-member-virtual",
  "course-member-semipresencial",
  "course-member-presencial",
]);
