import type {
  VerifikFinesRecord,
  VerifikFinesItem,
  VerifikTaxesRecord,
  VerifikValuationRecord,
  VerifikSinisterRecord,
  VerifikPicoYPlacaRecord,
} from "./verifik.interfaces";

export function toSafeStr(val: unknown, fallback = ""): string {
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  return fallback;
}

function parseFineAmount(amountRaw: unknown): number {
  if (typeof amountRaw === "number") {
    return amountRaw;
  }
  if (typeof amountRaw === "string") {
    return Number(amountRaw.replace(/\D/g, "")) || 0;
  }
  return 0;
}

function parseFineItem(item: unknown): VerifikFinesItem | null {
  if (!item || typeof item !== "object") {
    return null;
  }
  const itemObj = item as Record<string, unknown>;
  const amountRaw =
    itemObj.valor ?? itemObj.valorPagar ?? itemObj.total ?? itemObj.amount;
  const amount = parseFineAmount(amountRaw);

  return {
    id: toSafeStr(
      itemObj.numeroComparendo ??
        itemObj.id ??
        itemObj.consecutivo ??
        itemObj.numero,
    ),
    infractionCode: toSafeStr(
      itemObj.codigoInfraccion ?? itemObj.infraccion ?? itemObj.codigo,
    ),
    description: toSafeStr(
      itemObj.descripcion ?? itemObj.detalle ?? itemObj.concepto,
      "Comparendo de tránsito",
    ),
    amount,
    date: toSafeStr(itemObj.fechaComparendo ?? itemObj.fecha ?? itemObj.date),
    status: toSafeStr(itemObj.estadoComparendo ?? itemObj.estado, "PENDIENTE"),
    authority: toSafeStr(
      itemObj.organismoTransito ?? itemObj.secretaria ?? itemObj.entidad,
      "Secretaría de Movilidad",
    ),
    plate: toSafeStr(itemObj.placa ?? itemObj.plate),
  };
}

function resolveFinesList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) {
    return raw;
  }
  if (raw && typeof raw === "object") {
    const dataObj = raw as Record<string, unknown>;
    const candidate =
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

export function normalizeFines(raw: unknown): VerifikFinesRecord {
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
  };
}

function extractPendingTaxYears(obj: Record<string, unknown>): string[] {
  if (Array.isArray(obj.vigenciasPendientes)) {
    return obj.vigenciasPendientes as string[];
  }
  if (Array.isArray(obj.periodos)) {
    return obj.periodos as string[];
  }
  return [];
}

export function normalizeTaxes(
  raw: unknown,
  plate: string,
): VerifikTaxesRecord {
  if (!raw || typeof raw !== "object") {
    return {
      plate,
      status: "AL_DIA",
      pendingYears: [],
      totalAmount: 0,
      message:
        "A paz y salvo en el registro distrital de impuestos vehiculares.",
    };
  }

  const obj = raw as Record<string, unknown>;
  const estado = toSafeStr(obj.estado ?? obj.status).toUpperCase();
  const pendientes = extractPendingTaxYears(obj);

  const totalRaw = obj.totalPagar ?? obj.valorTotal ?? obj.total ?? 0;
  const totalAmount =
    typeof totalRaw === "number"
      ? totalRaw
      : Number(toSafeStr(totalRaw).replace(/\D/g, "")) || 0;

  let status: VerifikTaxesRecord["status"] = "AL_DIA";
  if (
    pendientes.length > 0 ||
    totalAmount > 0 ||
    estado.includes("DEUDOR") ||
    estado.includes("PENDIENTE")
  ) {
    status = "PENDIENTE";
  } else if (estado.includes("EXENTO")) {
    status = "EXENTO";
  }

  return {
    plate,
    status,
    pendingYears: pendientes,
    totalAmount,
    lastPaymentDate: typeof obj.ultimoPago === "string" ? obj.ultimoPago : null,
    message:
      status === "AL_DIA"
        ? "Vehículo a paz y salvo con sus obligaciones tributarias."
        : `Registra ${pendientes.length || 1} vigencia(s) pendientes de pago.`,
  };
}

export function normalizeValuation(
  rawFasecolda: unknown,
  rawSibga: unknown,
  plate: string,
): VerifikValuationRecord {
  const fasecoldaObj =
    rawFasecolda && typeof rawFasecolda === "object"
      ? (rawFasecolda as Record<string, unknown>)
      : {};
  const sibgaObj =
    rawSibga && typeof rawSibga === "object"
      ? (rawSibga as Record<string, unknown>)
      : {};

  const num = (v: unknown): number | null => {
    if (typeof v === "number" && !Number.isNaN(v)) return v;
    if (typeof v === "string") {
      const parsed = Number(v.replace(/\D/g, ""));
      return !Number.isNaN(parsed) && parsed > 0 ? parsed : null;
    }
    return null;
  };

  const fValue =
    num(fasecoldaObj.valor) ??
    num(fasecoldaObj.valorComercial) ??
    num(fasecoldaObj.value) ??
    num(fasecoldaObj.precio);

  const sValue =
    num(sibgaObj.avaluo) ??
    num(sibgaObj.valorAvaluo) ??
    num(sibgaObj.valuation) ??
    num(sibgaObj.baseGravable);

  const bestVal = fValue ?? sValue ?? 0;
  const marketMin = bestVal > 0 ? Math.round(bestVal * 0.93) : null;
  const marketMax = bestVal > 0 ? Math.round(bestVal * 1.07) : null;

  return {
    plate,
    fasecoldaCode:
      typeof fasecoldaObj.codigoFasecolda === "string"
        ? fasecoldaObj.codigoFasecolda
        : null,
    fasecoldaValue: fValue,
    sibgaValuation: sValue,
    marketMin,
    marketMax,
    currency: "COP",
    lastUpdatedYear: new Date().getFullYear(),
  };
}

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
      status: "LIMPIO",
    };
  }

  const obj = raw as Record<string, unknown>;
  const list =
    obj.siniestros ??
    obj.sinisters ??
    obj.reclamaciones ??
    (Array.isArray(raw) ? raw : []);

  const records: VerifikSinisterRecord["records"] = [];
  if (Array.isArray(list)) {
    for (const item of list) {
      if (item && typeof item === "object") {
        const itemObj = item as Record<string, unknown>;
        records.push({
          date: toSafeStr(itemObj.fecha ?? itemObj.date),
          type: toSafeStr(
            itemObj.tipo ?? itemObj.cobertura,
            "Siniestro reportado",
          ),
          severity: toSafeStr(itemObj.gravedad ?? itemObj.severidad, "Menor"),
          amount: Number(itemObj.monto ?? itemObj.valor ?? 0),
          description: toSafeStr(itemObj.descripcion ?? itemObj.concepto),
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

export function calculatePicoYPlaca(
  plate: string,
  city = "bogota",
): VerifikPicoYPlacaRecord {
  const cleanPlate = (plate || "").trim().toUpperCase();
  const lastChar = cleanPlate.slice(-1);
  const lastDigitMatch = /\d/.exec(lastChar);
  const _lastDigit = lastDigitMatch ? Number(lastDigitMatch[0]) : null;

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
