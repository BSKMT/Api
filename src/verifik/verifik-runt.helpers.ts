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
    const first: unknown = (raw as unknown[])[0];
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

  const infoGen =
    data.informacionGeneral && typeof data.informacionGeneral === "object"
      ? (data.informacionGeneral as Record<string, unknown>)
      : {};
  const datosTec =
    data.datosTecnicos && typeof data.datosTecnicos === "object"
      ? (data.datosTecnicos as Record<string, unknown>)
      : {};

  const plate =
    str(data.plate) ??
    str(data.placa) ??
    str(infoGen.placa) ??
    str(infoGen.plate) ??
    fallbackPlate;

  const brand =
    str(data.marca) ??
    str(data.brand) ??
    str(infoGen.marca) ??
    str(infoGen.brand);

  const modelLine =
    str(data.linea) ??
    str(data.modelLine) ??
    str(data.line) ??
    str(infoGen.linea) ??
    str(infoGen.modelLine);

  const year =
    num(data.modelo) ??
    num(data.year) ??
    num(infoGen.modelo) ??
    num(infoGen.year);

  const displacementCc =
    num(data.cilindraje) ??
    num(data.displacementCc) ??
    num(datosTec.cilindrada) ??
    num(datosTec.cilindraje) ??
    num(datosTec.displacementCc);

  const color = str(data.color) ?? str(infoGen.color) ?? str(datosTec.color);

  const serviceType =
    str(data.servicio) ??
    str(data.serviceType) ??
    str(infoGen.servicio) ??
    str(infoGen.tipoServicio);

  const classType =
    str(data.clase) ??
    str(data.classType) ??
    str(infoGen.clase) ??
    str(infoGen.claseVehiculo);

  const engineNumber =
    str(data.numeroMotor) ??
    str(data.engineNumber) ??
    str(datosTec.numeroMotor) ??
    str(infoGen.numeroMotor);

  const vinOrChassis =
    str(data.numeroChasis) ??
    str(data.vin) ??
    str(data.chasis) ??
    str(datosTec.numeroChasis) ??
    str(datosTec.vin) ??
    str(infoGen.numeroChasis) ??
    str(infoGen.vin);

  const rawSoat = data.soat ?? data.polizaSoat ?? infoGen.soat ?? data.soats;

  const rawRtm =
    data.tecnomecanica ??
    data.rtm ??
    data.revisionTecnicomecanica ??
    data.tecnoMecanica ??
    infoGen.tecnoMecanica;

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
