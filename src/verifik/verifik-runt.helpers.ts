import type {
  VerifikSoatRecord,
  VerifikRtmRecord,
  VerifikRuntVehicleRecord,
} from "./verifik.interfaces";

/** Official allowed documentType sets documented in https://docs.verifik.co/ */
export const RUNT_VEHICLE_ALLOWED_DOC_TYPES = new Set([
  "CC",
  "CE",
  "PA",
  "NIT",
]);

export const RUNT_DRIVER_ALLOWED_DOC_TYPES = new Set([
  "CC",
  "TI",
  "CE",
  "PA",
  "PPT",
]);

export const BOGOTA_TAX_ALLOWED_DOC_TYPES = new Set(["CC", "NIT"]);

export const SIMIT_ALLOWED_DOC_TYPES = new Set(["CC", "PA", "CE", "TI", "RC"]);

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function numOrNull(v: unknown): number | null {
  if (typeof v === "number" && !Number.isNaN(v) && v > 0) return v;
  if (typeof v === "string") {
    const parsed = Number(v.replace(/\D/g, ""));
    return !Number.isNaN(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function pickString(
  sources: Record<string, unknown>[],
  keys: string[],
): string | null {
  for (const src of sources) {
    for (const key of keys) {
      const value = strOrNull(src[key]);
      if (value) return value;
    }
  }
  return null;
}

function pickNumber(
  sources: Record<string, unknown>[],
  keys: string[],
): number | null {
  for (const src of sources) {
    for (const key of keys) {
      const value = numOrNull(src[key]);
      if (value !== null) return value;
    }
  }
  return null;
}

export function normalizeRuntDate(val: unknown): string | null {
  if (typeof val !== "string" || !val.trim()) {
    return null;
  }
  const s = val.trim();
  const ddmmyyyyMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (ddmmyyyyMatch) {
    const [, d, m, y] = ddmmyyyyMatch;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }
  return s;
}

export function extractFirstObject(
  raw: unknown,
): Record<string, unknown> | null {
  if (!raw) return null;
  if (Array.isArray(raw)) {
    const first: unknown = (raw as unknown[])[0];
    return typeof first === "object" && first !== null
      ? (first as Record<string, unknown>)
      : null;
  }
  return typeof raw === "object" ? (raw as Record<string, unknown>) : null;
}

function normalizeSoatStatus(item: Record<string, unknown>): string | null {
  const raw = strOrNull(item.estado ?? item.status ?? item.estadoPoliza);
  if (raw) return raw.toUpperCase();
  if (typeof item.valid === "boolean") {
    return item.valid ? "VIGENTE" : "VENCIDO";
  }
  return null;
}

function normalizeRtmStatus(item: Record<string, unknown>): string | null {
  const raw = strOrNull(item.estado ?? item.status ?? item.estadoCertificado);
  if (raw) return raw.toUpperCase();
  const vigente = strOrNull(item.vigente)?.toUpperCase();
  if (vigente === "SI" || vigente === "SÍ" || vigente === "VIGENTE") {
    return "VIGENTE";
  }
  if (vigente === "NO") return "VENCIDA";
  if (vigente === "NO APLICA") return "NO_APLICA";
  if (typeof item.valid === "boolean") {
    return item.valid ? "VIGENTE" : "VENCIDA";
  }
  return null;
}

function extractStatusString(obj: unknown): string {
  if (typeof obj !== "object" || obj === null) return "";
  const rec = obj as Record<string, unknown>;
  const val =
    rec.estado ??
    rec.status ??
    rec.estadoPoliza ??
    rec.estadoCertificado ??
    rec.vigente;
  if (typeof val === "string") return val.trim().toUpperCase();
  if (typeof rec.valid === "boolean") return rec.valid ? "VIGENTE" : "VENCIDO";
  return "";
}

export function extractSoat(raw: unknown): VerifikSoatRecord | null {
  let item: Record<string, unknown> | null = null;
  if (Array.isArray(raw) && raw.length > 0) {
    const list: unknown[] = raw;
    const active = list.find((x) => {
      const status = extractStatusString(x);
      return (
        status === "VIGENTE" ||
        status === "ACTIVO" ||
        status === "ACTIVE" ||
        status === "SI"
      );
    });
    item =
      typeof active === "object" && active !== null
        ? (active as Record<string, unknown>)
        : extractFirstObject(raw);
  } else {
    item = extractFirstObject(raw);
  }
  if (!item) return null;

  return {
    status: normalizeSoatStatus(item),
    policyNumber: strOrNull(
      item.noPoliza ??
      item.numeroPoliza ??
      item.soatNumber ??
      item.policyNumber ??
      item.numero,
    ),
    insuranceCompany: strOrNull(
      item.entidadExpideSoat ??
      item.entidadAseguradora ??
      item.aseguradora ??
      item.insuranceCompany,
    ),
    startDate: normalizeRuntDate(
      item.fechaVigencia ??
      item.fechaVigenciaInicio ??
      item.coverageStartDate ??
      item.fechaInicio ??
      item.fechaExpedicion ??
      item.startDate,
    ),
    expiryDate: normalizeRuntDate(
      item.fechaVencimiento ??
      item.dueDate ??
      item.fechaVigenciaFin ??
      item.expiryDate,
    ),
  };
}

export function extractRtm(raw: unknown): VerifikRtmRecord | null {
  let item: Record<string, unknown> | null = null;
  if (Array.isArray(raw) && raw.length > 0) {
    const list: unknown[] = raw;
    const active = list.find((x) => {
      const status = extractStatusString(x);
      return (
        status === "VIGENTE" ||
        status === "ACTIVO" ||
        status === "APROBADA" ||
        status === "ACTIVE" ||
        status === "SI"
      );
    });
    item =
      typeof active === "object" && active !== null
        ? (active as Record<string, unknown>)
        : extractFirstObject(raw);
  } else {
    item = extractFirstObject(raw);
  }
  if (!item) return null;

  return {
    status: normalizeRtmStatus(item),
    certificateNumber: strOrNull(
      item.numeroCertificado ??
      item.nroCertificado ??
      item.reviewNumber ??
      item.certificateNumber ??
      item.control,
    ),
    cdaName: strOrNull(
      item.cdaExpide ??
      item.cda ??
      item.centroDiagnostico ??
      item.cdaName ??
      item.nombreCda,
    ),
    expeditionDate: normalizeRuntDate(
      item.fechaExpedicion ??
      item.fechaExpedicionCertificado ??
      item.expeditionDate,
    ),
    expiryDate: normalizeRuntDate(
      item.fechaVigencia ??
      item.fechaVigenciaFin ??
      item.fechaVencimiento ??
      item.dueDate ??
      item.expiryDate,
    ),
  };
}

export function normalizeRuntVehicle(
  data: Record<string, unknown> | unknown[],
  id: unknown,
  fallbackPlate: string,
): VerifikRuntVehicleRecord {
  const d = extractFirstObject(data) ?? asRecord(data);
  const unwrapped =
    d.data && typeof d.data === "object" && !Array.isArray(d.data)
      ? (d.data as Record<string, unknown>)
      : d;

  // Support ALL official Verifik RUNT response shapes:
  // - /v2/co/runt/vehicle-by-plate & /vehicle-by-plate-only -> informacionGeneral + datosTecnicos
  // - /v2/co/runt/vehiculo (basic) -> vehicle
  // - /v2/co/runt/vehiculo (SOAT/RTM variant) -> vehicleInformation + soat + techReview
  // - /v2/co/runt/propietarios -> top-level plate/brand/line/model
  const infoGen = asRecord(unwrapped.informacionGeneral);
  const vehicleBlock = asRecord(unwrapped.vehicle);
  const vehicleInfo = asRecord(unwrapped.vehicleInformation);
  const datosTec = asRecord(unwrapped.datosTecnicos);

  const generalSources = [
    infoGen,
    vehicleBlock,
    vehicleInfo,
    unwrapped,
    datosTec,
  ];
  const techSources = [datosTec, infoGen, vehicleBlock, unwrapped, vehicleInfo];

  const plate =
    pickString(generalSources, ["noPlaca", "placa", "plate"]) ?? fallbackPlate;
  const brand = pickString(generalSources, ["marca", "brand"]);
  const modelLine = pickString(generalSources, ["linea", "line", "modelLine"]);
  const year = pickNumber(generalSources, ["modelo", "model", "year"]);
  // Verifik/RUNT uses the official spelling "cilidraje" (missing 'n') in informacionGeneral
  const displacementCc = pickNumber(techSources, [
    "cilidraje",
    "cilindraje",
    "cilindrada",
    "displacementCc",
  ]);
  const color = pickString(generalSources, ["color"]);
  const serviceType = pickString(generalSources, [
    "tipoServicio",
    "servicio",
    "serviceType",
  ]);
  const classType = pickString(generalSources, [
    "claseVehiculo",
    "clasificacion",
    "clase",
    "classType",
  ]);
  const engineNumber = pickString(techSources, [
    "noMotor",
    "numeroMotor",
    "engineNumber",
  ]);
  const vinOrChassis = pickString(techSources, [
    "noVin",
    "noChasis",
    "numeroChasis",
    "vin",
    "chasis",
  ]);

  const rawSoat =
    unwrapped.soat ??
    unwrapped.polizaSoat ??
    infoGen.soat ??
    vehicleBlock.soat ??
    unwrapped.soats ??
    infoGen.soats;

  const rawRtm =
    unwrapped.tecnoMecanica ??
    unwrapped.techReview ??
    unwrapped.tecnomecanica ??
    unwrapped.rtm ??
    unwrapped.revisionTecnicomecanica ??
    infoGen.tecnoMecanica ??
    vehicleBlock.tecnoMecanica ??
    infoGen.rtm;

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
    verifikId: strOrNull(id),
  };
}

/**
 * Normalizes document type to the exact codes accepted by Verifik and Colombian RUNT:
 * - CC: Cédula de Ciudadanía
 * - CE: Cédula de Extranjería
 * - PA: Pasaporte (Verifik requires "PA" instead of "P" or "PASAPORTE")
 * - CD: Carné Diplomático
 * - NIT: Número de Identificación Tributaria
 * - TI: Tarjeta de Identidad
 * - RC: Registro Civil
 * - PPT: Permiso por Protección Temporal
 * - PEP: Permiso Especial de Permanencia
 */
export function normalizeRuntDocumentType(rawType?: string | null): string {
  if (!rawType) return "CC";
  const clean = rawType
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();

  if (
    clean === "CC" ||
    clean.includes("CIUDADAN") ||
    clean.includes("CEDULA DE CIUDADAN")
  ) {
    return "CC";
  }
  if (clean === "CE" || clean.includes("EXTRANJER")) {
    return "CE";
  }
  if (clean === "PA" || clean === "P" || clean.includes("PASAPORTE")) {
    return "PA";
  }
  if (
    clean === "CD" ||
    clean === "D" ||
    clean.includes("DIPLOMAT") ||
    clean.includes("CARNE") ||
    clean.includes("CARNET")
  ) {
    return "CD";
  }
  if (clean === "NIT" || clean.includes("TRIBUTARI")) {
    return "NIT";
  }
  if (
    clean === "TI" ||
    clean.includes("TARJETA DE IDENTIDAD") ||
    clean === "TARJETA IDENTIDAD"
  ) {
    return "TI";
  }
  if (clean === "RC" || clean.includes("REGISTRO CIVIL")) {
    return "RC";
  }
  if (clean === "PPT" || clean.includes("PROTECCION TEMPORAL")) {
    return "PPT";
  }
  if (clean === "PEP" || clean.includes("ESPECIAL DE PERMANENCIA")) {
    return "PEP";
  }

  return clean;
}

/**
 * Normalizes document numbers according to document type.
 * - CC, CE, PPT, PEP, TI, RC, NIT: strictly numeric per Verifik Colombia guide.
 * - PA (Pasaporte), CD (Carné Diplomático): preserves alphanumeric characters.
 */
export function normalizeRuntDocumentNumber(
  docType?: string | null,
  rawNumber?: string | null,
): string {
  if (!rawNumber) return "";
  const trimmed = rawNumber.trim().toUpperCase();
  const normalizedType = normalizeRuntDocumentType(docType);

  if (
    normalizedType === "CC" ||
    normalizedType === "CE" ||
    normalizedType === "PPT" ||
    normalizedType === "PEP" ||
    normalizedType === "TI" ||
    normalizedType === "RC" ||
    normalizedType === "NIT"
  ) {
    return trimmed.replace(/\D/g, "");
  }

  // Alphanumeric documents (Passports, Carné Diplomático)
  return trimmed.replace(/[^A-Z0-9]/g, "");
}
