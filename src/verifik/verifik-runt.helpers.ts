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

function extractStatusString(obj: unknown): string {
  if (typeof obj !== "object" || obj === null) return "";
  const rec = obj as Record<string, unknown>;
  const val =
    rec.estado ?? rec.status ?? rec.estadoPoliza ?? rec.estadoCertificado;
  return typeof val === "string" ? val.toUpperCase() : "";
}

export function extractSoat(raw: unknown): VerifikSoatRecord | null {
  let item: Record<string, unknown> | null = null;
  if (Array.isArray(raw) && raw.length > 0) {
    const list: unknown[] = raw;
    const active = list.find((x) => {
      const status = extractStatusString(x);
      return status === "VIGENTE" || status === "ACTIVO" || status === "ACTIVE";
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
  let item: Record<string, unknown> | null = null;
  if (Array.isArray(raw) && raw.length > 0) {
    const list: unknown[] = raw;
    const active = list.find((x) => {
      const status = extractStatusString(x);
      return (
        status === "VIGENTE" ||
        status === "ACTIVO" ||
        status === "APROBADA" ||
        status === "ACTIVE"
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
  data: Record<string, unknown> | unknown[],
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

  const d = (extractFirstObject(data) ??
    (typeof data === "object" && data !== null ? data : {})) as Record<
    string,
    unknown
  >;
  const unwrapped =
    d.data && typeof d.data === "object" && !Array.isArray(d.data)
      ? (d.data as Record<string, unknown>)
      : d;

  const infoGen =
    unwrapped.informacionGeneral &&
    typeof unwrapped.informacionGeneral === "object"
      ? (unwrapped.informacionGeneral as Record<string, unknown>)
      : {};
  const datosTec =
    unwrapped.datosTecnicos && typeof unwrapped.datosTecnicos === "object"
      ? (unwrapped.datosTecnicos as Record<string, unknown>)
      : {};

  const plate =
    str(unwrapped.plate) ??
    str(unwrapped.placa) ??
    str(infoGen.placa) ??
    str(infoGen.plate) ??
    fallbackPlate;

  const brand =
    str(unwrapped.marca) ??
    str(unwrapped.brand) ??
    str(infoGen.marca) ??
    str(infoGen.brand);

  const modelLine =
    str(unwrapped.linea) ??
    str(unwrapped.modelLine) ??
    str(unwrapped.line) ??
    str(infoGen.linea) ??
    str(infoGen.modelLine);

  const year =
    num(unwrapped.modelo) ??
    num(unwrapped.year) ??
    num(infoGen.modelo) ??
    num(infoGen.year);

  const displacementCc =
    num(unwrapped.cilindraje) ??
    num(unwrapped.displacementCc) ??
    num(datosTec.cilindrada) ??
    num(datosTec.cilindraje) ??
    num(datosTec.displacementCc);

  const color =
    str(unwrapped.color) ?? str(infoGen.color) ?? str(datosTec.color);

  const serviceType =
    str(unwrapped.servicio) ??
    str(unwrapped.serviceType) ??
    str(infoGen.servicio) ??
    str(infoGen.tipoServicio);

  const classType =
    str(unwrapped.clase) ??
    str(unwrapped.classType) ??
    str(infoGen.clase) ??
    str(infoGen.claseVehiculo);

  const engineNumber =
    str(unwrapped.numeroMotor) ??
    str(unwrapped.engineNumber) ??
    str(datosTec.numeroMotor) ??
    str(infoGen.numeroMotor);

  const vinOrChassis =
    str(unwrapped.numeroChasis) ??
    str(unwrapped.vin) ??
    str(unwrapped.chasis) ??
    str(datosTec.numeroChasis) ??
    str(datosTec.vin) ??
    str(infoGen.numeroChasis) ??
    str(infoGen.vin);

  const rawSoat =
    unwrapped.soat ??
    unwrapped.polizaSoat ??
    infoGen.soat ??
    unwrapped.soats ??
    infoGen.soats;

  const rawRtm =
    unwrapped.tecnomecanica ??
    unwrapped.rtm ??
    unwrapped.revisionTecnicomecanica ??
    unwrapped.tecnoMecanica ??
    infoGen.tecnoMecanica ??
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
    verifikId: str(id),
  };
}
