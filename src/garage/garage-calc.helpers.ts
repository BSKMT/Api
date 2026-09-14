import {
  MaintenanceLog,
  MaintenanceType,
} from "./schemas/maintenance-log.schema";

export function getDocumentStatus(
  days: number | null,
): "sin_registrar" | "vencido" | "por_vencer" | "vigente" {
  if (days === null) {
    return "sin_registrar";
  }
  if (days < 0) {
    return "vencido";
  }
  if (days <= 15) {
    return "por_vencer";
  }
  return "vigente";
}

export function getComponentHealthStatus(
  percent: number,
): "critico" | "atencion" | "optimo" {
  if (percent <= 15) {
    return "critico";
  }
  if (percent <= 35) {
    return "atencion";
  }
  return "optimo";
}

export function calculateDaysRemaining(
  date: Date | null | undefined,
): number | null {
  if (!date) {
    return null;
  }
  const now = new Date();
  return Math.ceil(
    (new Date(date).getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
  );
}

export function parseDateOrNull(
  val: string | Date | null | undefined,
): Date | null {
  if (!val) {
    return null;
  }
  return new Date(val);
}

export function hasPartIntervention(
  log: MaintenanceLog,
  type: MaintenanceType,
  keywords: string[],
): boolean {
  if (log.maintenanceType === type) {
    return true;
  }
  return (
    log.partsChanged?.some((part) => {
      const lower = part.toLowerCase();
      return keywords.some((kw) => lower.includes(kw));
    }) ?? false
  );
}

export function getBaseNewPrice(displacement: number): number {
  if (displacement >= 1000) return 85000000;
  if (displacement >= 700) return 58000000;
  if (displacement >= 450) return 38000000;
  if (displacement >= 300) return 28000000;
  if (displacement >= 200) return 18000000;
  return 12000000;
}
