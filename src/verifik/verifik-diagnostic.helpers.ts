import type {
  VerifikFinesRecord,
  VerifikFinesItem,
  VerifikTaxesRecord,
  VerifikValuationRecord,
  VerifikSinisterRecord,
  VerifikPicoYPlacaRecord,
  VerifikDriverLicenseRecord,
} from "./verifik.interfaces";
import { normalizeRuntDate } from "./verifik-runt.helpers";

export function toSafeStr(val: unknown, fallback = ""): string {
  if (typeof val === "string") return val.trim();
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  return fallback;
}

function parseCopAmount(amountRaw: unknown): number {
  if (typeof amountRaw === "number" && Number.isFinite(amountRaw)) {
    return amountRaw;
  }
  if (typeof amountRaw === "string") {
    const digits = amountRaw.replace(/\D/g, "");
    return digits ? Number(digits) || 0 : 0;
  }
  return 0;
}

function parsePositiveNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  if (typeof v === "string") {
    const digits = v.replace(/\D/g, "");
    const parsed = digits ? Number(digits) : Number.NaN;
    return !Number.isNaN(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

/**
 * Unwraps Verifik SIMIT nested payload shapes (both standard `data` and
 * legacy double-wrapped `{ value: { value: { data } } }`).
 */
export function unwrapSimitPayload(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return raw;
  }
  let current = raw as Record<string, unknown>;
  for (let depth = 0; depth < 3; depth++) {
    if (
      current.value &&
      typeof current.value === "object" &&
      !Array.isArray(current.value)
    ) {
      current = current.value as Record<string, unknown>;
      continue;
    }
    if (
      current.data &&
      typeof current.data === "object" &&
      !Array.isArray(current.data)
    ) {
      current = current.data as Record<string, unknown>;
      continue;
    }
    break;
  }
  return current;
}

function extractFirstInfraction(
  itemObj: Record<string, unknown>,
): Record<string, unknown> | null {
  if (
    !Array.isArray(itemObj.infracciones) ||
    itemObj.infracciones.length === 0
  ) {
    return null;
  }
  const first: unknown = itemObj.infracciones[0];
  return first && typeof first === "object"
    ? (first as Record<string, unknown>)
    : null;
}

function parseFineItem(item: unknown): VerifikFinesItem | null {
  if (!item || typeof item !== "object") {
    return null;
  }
  const itemObj = item as Record<string, unknown>;
  const firstInfraction = extractFirstInfraction(itemObj);
  const amountRaw =
    itemObj.valorPagar ??
    itemObj.pendingBalance ??
    itemObj.valor ??
    itemObj.total ??
    itemObj.balance ??
    itemObj.amount ??
    firstInfraction?.valorInfraccion;
  const amount = parseCopAmount(amountRaw);

  const authorityFallback = itemObj.impositionMedium
    ? "Secretaría Distrital de Movilidad"
    : "Secretaría de Movilidad";

  return {
    id: toSafeStr(
      itemObj.numeroComparendo ??
        itemObj["NúmeroComparendo"] ??
        itemObj.number ??
        itemObj.id ??
        itemObj.consecutivo ??
        itemObj.numero,
    ),
    infractionCode: toSafeStr(
      itemObj.codigoInfraccion ??
        firstInfraction?.codigoInfraccion ??
        itemObj.infraccion ??
        itemObj.codigo ??
        itemObj.type,
    ),
    description: toSafeStr(
      itemObj.descripcionInfraccion ??
        firstInfraction?.descripcionInfraccion ??
        itemObj.descripcion ??
        itemObj.detalle ??
        itemObj.concepto ??
        itemObj.impositionMedium ??
        itemObj.type,
      "Comparendo de tránsito",
    ),
    amount,
    date: toSafeStr(
      itemObj.fechaComparendo ??
        itemObj.impositionDate ??
        itemObj.fecha ??
        itemObj.date,
    ),
    status: toSafeStr(
      itemObj.estadoComparendo ?? itemObj.status ?? itemObj.estado,
      "PENDIENTE",
    ),
    authority: toSafeStr(
      itemObj.organismoTransito ??
        itemObj.secretariaComparendo ??
        itemObj.secretaria ??
        itemObj.entidad,
      authorityFallback,
    ),
    plate: toSafeStr(itemObj.placa ?? itemObj.placavehiculo ?? itemObj.plate),
  };
}

function resolveFinesList(raw: unknown): unknown[] {
  const unwrapped = unwrapSimitPayload(raw);
  if (Array.isArray(unwrapped)) {
    return unwrapped;
  }
  if (unwrapped && typeof unwrapped === "object") {
    const dataObj = unwrapped as Record<string, unknown>;
    const candidate =
      dataObj.fines ??
      dataObj.comparendos ??
      dataObj.multas ??
      dataObj.infracciones ??
      dataObj.data;
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }
  return [];
}

export function normalizeFines(
  raw: unknown,
  status: VerifikFinesRecord["status"] = "VERIFICADO",
  message?: string,
): VerifikFinesRecord {
  const now = new Date().toISOString();
  const rawList = resolveFinesList(raw);
  const finesArray: VerifikFinesItem[] = [];
  let totalAmount = 0;

  for (const item of rawList) {
    const parsed = parseFineItem(item);
    if (parsed) {
      finesArray.push(parsed);
      totalAmount += parsed.amount;
    }
  }

  return {
    hasFines: finesArray.length > 0,
    totalFines: finesArray.length,
    totalAmount,
    fines: finesArray,
    lastCheckedAt: now,
    status,
    ...(message ? { message } : {}),
  };
}

function parseBogotaObligationVehicles(obj: Record<string, unknown>): {
  years: string[];
  total: number;
  recognized: boolean;
} {
  const obligation = obj.obligation;
  if (!obligation || typeof obligation !== "object") {
    return { years: [], total: 0, recognized: false };
  }
  const vehicles = (obligation as Record<string, unknown>).vehicle;
  if (!Array.isArray(vehicles)) {
    return { years: [], total: 0, recognized: true };
  }

  const years: string[] = [];
  let total = 0;
  for (const entry of vehicles) {
    if (!entry || typeof entry !== "object") continue;
    const rec = entry as Record<string, unknown>;
    const obsStatus = toSafeStr(
      rec.obligationStatus ?? rec.status,
    ).toUpperCase();
    const amount = parseCopAmount(rec.totalToPay ?? rec.obligation);
    const isOverdue =
      obsStatus.includes("MOROS") ||
      obsStatus.includes("PENDIENT") ||
      obsStatus.includes("DEUD") ||
      amount > 0;
    if (isOverdue) {
      const yr = toSafeStr(rec.taxableYear ?? rec.year);
      if (yr && !years.includes(yr)) years.push(yr);
      total += amount;
    }
  }
  return { years, total, recognized: true };
}

function extractPendingTaxYears(obj: Record<string, unknown>): string[] {
  if (Array.isArray(obj.vigenciasPendientes)) {
    return obj.vigenciasPendientes.map((y) => toSafeStr(y)).filter(Boolean);
  }
  if (Array.isArray(obj.periodos)) {
    return obj.periodos.map((y) => toSafeStr(y)).filter(Boolean);
  }
  return [];
}

/**
 * Normalizes Bogotá vehicle tax responses (`/v2/co/bogota/vehicle/tax`).
 * NIST CSF 2.0 PR.DS-06: NEVER fabricates `AL_DIA` when upstream data is null/unavailable.
 */
export function normalizeTaxes(
  raw: unknown,
  plate: string,
): VerifikTaxesRecord {
  if (!raw || typeof raw !== "object") {
    return {
      plate,
      status: "DESCONOCIDO",
      pendingYears: [],
      totalAmount: 0,
      message:
        "No fue posible verificar el estado de impuestos distritales en este momento.",
    };
  }

  const obj = raw as Record<string, unknown>;
  const bogota = parseBogotaObligationVehicles(obj);
  const legacyPending = extractPendingTaxYears(obj);
  const pendientes = bogota.recognized ? bogota.years : legacyPending;

  const estado = toSafeStr(obj.estado ?? obj.status).toUpperCase();
  const totalAmount = bogota.recognized
    ? bogota.total
    : parseCopAmount(obj.totalPagar ?? obj.valorTotal ?? obj.total ?? 0);

  let status: VerifikTaxesRecord["status"] = "AL_DIA";
  if (
    pendientes.length > 0 ||
    totalAmount > 0 ||
    estado.includes("DEUDOR") ||
    estado.includes("MOROS") ||
    estado.includes("PENDIENTE")
  ) {
    status = "PENDIENTE";
  } else if (estado.includes("EXENTO")) {
    status = "EXENTO";
  }

  let message = "Vehículo a paz y salvo con sus obligaciones tributarias.";
  if (status === "PENDIENTE") {
    message = `Registra ${pendientes.length || 1} vigencia(s) pendientes de pago.`;
  } else if (status === "EXENTO") {
    message = "Vehículo exento de impuesto vehicular en Bogotá.";
  }

  return {
    plate,
    status,
    pendingYears: pendientes,
    totalAmount,
    lastPaymentDate: typeof obj.ultimoPago === "string" ? obj.ultimoPago : null,
    message,
  };
}

function scaleFasecoldaThousandsToCop(val: number): number {
  // Official Verifik Fasecolda docs: `valueModel[].valor` and `bcpp` are in
  // thousands of COP (e.g. `34500` => $34,500,000 COP). Values already >= 1,000,000
  // are treated as full COP.
  return val < 1_000_000 ? val * 1000 : val;
}

function extractFasecoldaValue(
  fasecoldaObj: Record<string, unknown>,
  vehicleYear?: number | null,
): number | null {
  const valueModels: unknown[] | null = Array.isArray(fasecoldaObj.valueModel)
    ? (fasecoldaObj.valueModel as unknown[])
    : null;
  if (valueModels && valueModels.length > 0) {
    const targetYear =
      vehicleYear ?? parsePositiveNumber(fasecoldaObj.year) ?? null;
    const matched = targetYear
      ? valueModels.find(
          (entry) =>
            entry &&
            typeof entry === "object" &&
            parsePositiveNumber((entry as Record<string, unknown>).modelo) ===
              targetYear,
        )
      : null;
    const chosen = (matched ?? valueModels[0]) as Record<string, unknown>;
    const modelVal = parsePositiveNumber(chosen?.valor);
    if (modelVal !== null) {
      return scaleFasecoldaThousandsToCop(modelVal);
    }
  }

  const bcppVal = parsePositiveNumber(fasecoldaObj.bcpp);
  if (bcppVal !== null) {
    return scaleFasecoldaThousandsToCop(bcppVal);
  }

  return (
    parsePositiveNumber(fasecoldaObj.valor) ??
    parsePositiveNumber(fasecoldaObj.valorComercial) ??
    parsePositiveNumber(fasecoldaObj.value) ??
    parsePositiveNumber(fasecoldaObj.precio)
  );
}

function extractSibgaValue(sibgaObj: Record<string, unknown>): number | null {
  if (
    sibgaObj.valuation &&
    typeof sibgaObj.valuation === "object" &&
    !Array.isArray(sibgaObj.valuation)
  ) {
    const commercial = parsePositiveNumber(
      (sibgaObj.valuation as Record<string, unknown>).commercialValue,
    );
    if (commercial !== null) return commercial;
  }
  return (
    parsePositiveNumber(sibgaObj.avaluo) ??
    parsePositiveNumber(sibgaObj.valorAvaluo) ??
    parsePositiveNumber(sibgaObj.valuation) ??
    parsePositiveNumber(sibgaObj.baseGravable)
  );
}

export function normalizeValuation(
  rawFasecolda: unknown,
  rawSibga: unknown,
  plate: string,
  vehicleYear?: number | null,
): VerifikValuationRecord {
  const fasecoldaObj =
    rawFasecolda && typeof rawFasecolda === "object"
      ? (rawFasecolda as Record<string, unknown>)
      : {};
  const sibgaObj =
    rawSibga && typeof rawSibga === "object"
      ? (rawSibga as Record<string, unknown>)
      : {};

  const fValue = extractFasecoldaValue(fasecoldaObj, vehicleYear);
  const sValue = extractSibgaValue(sibgaObj);

  const bestVal = fValue ?? sValue ?? 0;
  const marketMin = bestVal > 0 ? Math.round(bestVal * 0.93) : null;
  const marketMax = bestVal > 0 ? Math.round(bestVal * 1.07) : null;

  const codeCandidate =
    fasecoldaObj.code ??
    fasecoldaObj.homoloCode ??
    fasecoldaObj.codigoFasecolda;
  const fasecoldaCode =
    typeof codeCandidate === "string" && codeCandidate.trim()
      ? codeCandidate.trim()
      : null;

  let status: VerifikValuationRecord["status"] = "DESCONOCIDO";
  if (fValue !== null && sValue !== null) {
    status = "VERIFICADO";
  } else if (fValue !== null || sValue !== null || fasecoldaCode !== null) {
    status = "PARCIAL";
  }

  return {
    plate,
    fasecoldaCode,
    fasecoldaValue: fValue,
    sibgaValuation: sValue,
    marketMin,
    marketMax,
    currency: "COP",
    lastUpdatedYear:
      parsePositiveNumber(sibgaObj.period) ?? new Date().getFullYear(),
    status,
  };
}

/**
 * Normalizes Fasecolda claims/sinisters (`/v2/co/fasecolda/sinister`).
 * Official response key is singular `sinister[]` with `accidentDate` and `protection`.
 * NIST CSF 2.0 PR.DS-06: NEVER fabricates `LIMPIO` when upstream data is null/unavailable.
 */
export function normalizeSinister(
  raw: unknown,
  plate: string,
): VerifikSinisterRecord {
  if (!raw || typeof raw !== "object") {
    return {
      plate,
      hasSinister: false,
      sinisterCount: 0,
      records: [],
      status: "DESCONOCIDO",
      message:
        "No fue posible consultar el historial de siniestros en Fasecolda en este momento.",
    };
  }

  const obj = raw as Record<string, unknown>;
  const list =
    obj.sinister ??
    obj.siniestros ??
    obj.sinisters ??
    obj.reclamaciones ??
    (Array.isArray(raw) ? raw : []);

  const records: VerifikSinisterRecord["records"] = [];
  if (Array.isArray(list)) {
    for (const item of list) {
      if (item && typeof item === "object") {
        const itemObj = item as Record<string, unknown>;
        const protection = toSafeStr(
          itemObj.protection ?? itemObj.tipo ?? itemObj.cobertura,
          "Siniestro reportado",
        );
        records.push({
          date: toSafeStr(
            itemObj.accidentDate ?? itemObj.fecha ?? itemObj.date,
          ),
          type: protection,
          severity: toSafeStr(
            itemObj.gravedad ?? itemObj.severidad ?? protection,
            "Reportado",
          ),
          amount: parseCopAmount(itemObj.monto ?? itemObj.valor ?? 0),
          description: toSafeStr(
            itemObj.descripcion ?? itemObj.concepto ?? protection,
          ),
        });
      }
    }
  }

  return {
    plate,
    hasSinister: records.length > 0,
    sinisterCount: records.length,
    records,
    status: records.length > 0 ? "CON_HISTORIAL" : "LIMPIO",
  };
}

function mapDriverLicenseStatus(
  rawStatus: string,
): VerifikDriverLicenseRecord["status"] {
  const upper = rawStatus.trim().toUpperCase();
  if (upper === "ACTIVA" || upper === "ACTIVO" || upper === "VIGENTE") {
    return "ACTIVA";
  }
  if (upper.includes("VENCID")) return "VENCIDA";
  if (upper.includes("SUSPEND")) return "SUSPENDIDA";
  if (upper.includes("CANCEL")) return "CANCELADA";
  return "NO_REGISTRA";
}

/**
 * Normalizes official Verifik RUNT conductor responses (`/v2/co/runt/conductor`
 * and `/v3/co/runt/conductor`), which return `licenses[]` with `category`,
 * `dueDate`, `expeditionDate`, `status`, and top-level `driverStatus`/`citizenStatus`.
 */
export function normalizeDriverLicense(
  raw: unknown,
  documentType: string,
  documentNumber: string,
): VerifikDriverLicenseRecord {
  if (!raw || typeof raw !== "object") {
    return {
      documentNumber,
      documentType,
      status: "NO_REGISTRA",
      categories: [],
      expeditionDate: null,
      expiryDate: null,
    };
  }

  const d = raw as Record<string, unknown>;
  let rawList: unknown[] = [];
  if (Array.isArray(d.licenses)) {
    rawList = d.licenses;
  } else if (Array.isArray(d.categorias)) {
    rawList = d.categorias;
  } else if (Array.isArray(d.categories)) {
    rawList = d.categories;
  }

  const categories = rawList
    .map((entry) => {
      const rec = (entry && typeof entry === "object" ? entry : {}) as Record<
        string,
        unknown
      >;
      const category = toSafeStr(rec.category ?? rec.categoria);
      if (!category) return null;
      return {
        category,
        validUntil: normalizeRuntDate(
          rec.dueDate ?? rec.fechaVencimiento ?? rec.validUntil,
        ),
        status: toSafeStr(rec.status ?? rec.estado),
        expeditionDate: normalizeRuntDate(
          rec.expeditionDate ?? rec.fechaExpedicion,
        ),
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  const activeLicense =
    categories.find((c) => c.status.toUpperCase() === "ACTIVA") ??
    categories[0];

  const resolvedStatus = mapDriverLicenseStatus(
    activeLicense?.status ||
      toSafeStr(d.driverStatus ?? d.citizenStatus ?? d.estado),
  );

  return {
    documentNumber: toSafeStr(d.documentNumber, documentNumber),
    documentType: toSafeStr(d.documentType, documentType),
    status: categories.length > 0 ? resolvedStatus : "NO_REGISTRA",
    categories: categories.map(({ category, validUntil, status }) => ({
      category,
      validUntil,
      status,
    })),
    expeditionDate:
      activeLicense?.expeditionDate ??
      normalizeRuntDate(d.fechaExpedicion ?? d.expeditionDate),
    expiryDate:
      activeLicense?.validUntil ??
      normalizeRuntDate(d.fechaVencimiento ?? d.dueDate),
  };
}

export function calculatePicoYPlaca(
  plate: string,
  city = "bogota",
): VerifikPicoYPlacaRecord {
  const cleanPlate = (plate || "").trim().toUpperCase();
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 Sun, 6 Sat

  // En Bogotá, las motos particulares no tienen restricción general permanente de pico y placa
  if (city.toLowerCase() === "bogota") {
    return {
      plate: cleanPlate,
      hasRestrictionToday: false,
      restrictionHours: null,
      city: "Bogotá D.C.",
      nextRestrictionDate: null,
      message: "Exenta de Pico y Placa general para motocicletas en Bogotá.",
    };
  }

  // En Medellín: pico y placa para motos de 2 tiempos y 4 tiempos rige de lunes a viernes según primer dígito
  const firstDigitMatch = /\d/.exec(cleanPlate);
  const firstDigit = firstDigitMatch ? Number(firstDigitMatch[0]) : 0;
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  return {
    plate: cleanPlate,
    hasRestrictionToday: !isWeekend && firstDigit % 2 === dayOfWeek % 2,
    restrictionHours: isWeekend ? null : "05:00 a 20:00",
    city: "Medellín",
    nextRestrictionDate: isWeekend ? "Lunes próximo según rotación" : null,
    message: isWeekend
      ? "Sin restricción de fin de semana."
      : "Sujeto a rotación semestral de dígitos de Medellín.",
  };
}
