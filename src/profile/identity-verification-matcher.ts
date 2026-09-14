import type { VerifikDocumentType } from "../verifik/verifik.service";

export const DOCUMENT_TYPE_MAP: Array<{
  label: RegExp;
  verifik: VerifikDocumentType;
}> = [
  { label: /^CEDULA DE CIUDADANIA$/, verifik: "CC" },
  { label: /^CC$/, verifik: "CC" },
  { label: /^CEDULA DE EXTRANJERIA$/, verifik: "CE" },
  { label: /^CE$/, verifik: "CE" },
  { label: /^PPT$/, verifik: "PPT" },
  { label: /PROTECCION TEMPORAL/, verifik: "PPT" },
  { label: /^PEP$/, verifik: "PEP" },
  { label: /PERMANENCIA/, verifik: "PEP" },
];

export const DOCUMENT_NUMBER_PATTERN: Record<VerifikDocumentType, RegExp> = {
  CC: /^\d{5,10}$/,
  CE: /^\d{4,10}$/,
  PPT: /^\d{3,10}$/,
  PEP: /^\d{15}$/,
};

export const REQUIRES_EXPEDITION_DATE: Record<VerifikDocumentType, boolean> = {
  CC: false,
  CE: true,
  PPT: true,
  PEP: true,
};

export const NAME_SIMILARITY_THRESHOLD = 0.75;

export function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function mapDocumentType(raw: string): VerifikDocumentType | null {
  if (!raw) return null;
  const normalized = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
  for (const entry of DOCUMENT_TYPE_MAP) {
    if (entry.label.test(normalized)) return entry.verifik;
  }
  return null;
}

export function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function mapOfficialGender(gender: string): string | null {
  const normalized = normalizeName(gender);
  if (normalized === "HOMBRE" || normalized === "M") return "MASCULINO";
  if (normalized === "MUJER" || normalized === "F") return "FEMENINO";
  return null;
}

export function mapOfficialGenderToLabel(gender: string): string | null {
  const mapped = mapOfficialGender(gender);
  if (mapped === "MASCULINO") return "Masculino";
  if (mapped === "FEMENINO") return "Femenino";
  return null;
}

export function diceCoefficient(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const bigrams = new Map<string, number>();
  for (let i = 0; i < b.length - 1; i++) {
    const gram = b.slice(i, i + 2);
    bigrams.set(gram, (bigrams.get(gram) ?? 0) + 1);
  }

  let intersections = 0;
  for (let i = 0; i < a.length - 1; i++) {
    const gram = a.slice(i, i + 2);
    const count = bigrams.get(gram) ?? 0;
    if (count > 0) {
      bigrams.set(gram, count - 1);
      intersections++;
    }
  }

  return (2 * intersections) / (a.length - 1 + b.length - 1);
}

export function namesMatch(declared: string, official: string): boolean {
  const a = normalizeName(declared);
  const b = normalizeName(official);
  if (!a || !b) return false;
  if (a === b) return true;

  const tokensA = a.split(" ");
  const tokensB = b.split(" ");
  const setB = new Set(tokensB);
  const setA = new Set(tokensA);

  if (tokensA.length >= 2 && tokensA.every((t) => setB.has(t))) return true;
  if (tokensB.length >= 2 && tokensB.every((t) => setA.has(t))) return true;

  return diceCoefficient(a, b) >= NAME_SIMILARITY_THRESHOLD;
}
