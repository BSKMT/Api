import type {
  VerifikSoatRecord,
  VerifikRtmRecord,
  VerifikRuntVehicleRecord,
} from "./verifik.interfaces";

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
  return s;
}

export function extractFirstObject(
  raw: unknown,
): Record<string, unknown> | null {
  if (!raw) return null;
  if (Array.isArray(raw)) {
    const first = raw[0];
    return typeof first === "object" && first !== null
      ? (first as Record<string, unknown>)
      : null;
  }
  return typeof raw === "object" ? (raw as Record<string, unknown>) : null;
}

export function extractSoat(raw: unknown): VerifikSoatRecord | null {
  const item = extractFirstObject(raw);
  if (!item) return null;

  return {
    status: (item.estado ?? item.status ?? item.estadoPoliza ?? null) as
      string | null,
    policyNumber: (item.numeroPoliza ??
      item.policyNumber ??
      item.numero ??
      null) as string | null,
    insuranceCompany: (item.entidadAseguradora ??
      item.aseguradora ??
      item.insuranceCompany ??
      null) as string | null,
    startDate: normalizeRuntDate(
      item.fechaVigenciaInicio ?? item.fechaInicio ?? item.startDate,
    ),
    expiryDate: normalizeRuntDate(
      item.fechaVigenciaFin ?? item.fechaVencimiento ?? item.expiryDate,
    ),
  };
}

export function extractRtm(raw: unknown): VerifikRtmRecord | null {
  const item = extractFirstObject(raw);
  if (!item) return null;

  return {
    status: (item.estado ?? item.status ?? item.estadoCertificado ?? null) as
      string | null,
    certificateNumber: (item.numeroCertificado ??
      item.certificateNumber ??
      item.control ??
      null) as string | null,
    cdaName: (item.cda ??
      item.centroDiagnostico ??
      item.cdaName ??
      item.nombreCda ??
      null) as string | null,
    expeditionDate: normalizeRuntDate(
      item.fechaExpedicion ??
        item.fechaExpedicionCertificado ??
        item.expeditionDate,
    ),
    expiryDate: normalizeRuntDate(
      item.fechaVigenciaFin ?? item.fechaVencimiento ?? item.expiryDate,
    ),
  };
}

export function normalizeRuntVehicle(
  data: Record<string, unknown>,
  id: unknown,
  fallbackPlate: string,
): VerifikRuntVehicleRecord {
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? v.trim() : null;

  const num = (v: unknown): number | null => {
    if (typeof v === "number" && !Number.isNaN(v)) return v;
    if (typeof v === "string") {
      const parsed = Number(v.replace(/\D/g, ""));
      return !Number.isNaN(parsed) && parsed > 0 ? parsed : null;
    }
    return null;
  };

  const plate = str(data.plate) ?? str(data.placa) ?? fallbackPlate;
  const brand = str(data.marca) ?? str(data.brand);
  const modelLine = str(data.linea) ?? str(data.modelLine) ?? str(data.line);
  const year = num(data.modelo) ?? num(data.year);
  const displacementCc = num(data.cilindraje) ?? num(data.displacementCc);
  const color = str(data.color);
  const serviceType = str(data.servicio) ?? str(data.serviceType);
  const classType = str(data.clase) ?? str(data.classType);
  const engineNumber = str(data.numeroMotor) ?? str(data.engineNumber);
  const vinOrChassis =
    str(data.numeroChasis) ?? str(data.vin) ?? str(data.chasis);

  const rawSoat = data.soat ?? data.polizaSoat;
  const rawRtm = data.tecnomecanica ?? data.rtm ?? data.revisionTecnicomecanica;

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
    verifikId: str(id),
  };
}
