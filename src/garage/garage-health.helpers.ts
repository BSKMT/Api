import type { UsageProfile } from "./schemas/garage-motorcycle.schema";
import { MaintenanceType } from "./schemas/maintenance-log.schema";
import {
  OIL_DEGRADATION,
  CHAIN_DEGRADATION,
  BRAKE_DEGRADATION,
  BRAND_MULTIPLIERS,
} from "./garage.constants";
import {
  getComponentHealthStatus,
  hasPartIntervention,
  getBaseNewPrice,
} from "./garage-calc.helpers";
import type { TelemetryMotorcycleInput } from "./garage-telemetry.helpers";

export interface ComponentWearReport {
  lifePercent: number;
  remainingKm: number;
  remainingDays: number;
  lastServiceKm: number;
  status: string;
}

export interface PredictiveHealthResult {
  report: {
    isLockedForFree: boolean;
    oil?: ComponentWearReport;
    chainKit?: ComponentWearReport;
    brakes?: ComponentWearReport;
  };
  brakeLifePercent: number;
  oilLifePercent: number;
  chainLifePercent: number;
  oilRemainingKm: number;
}

export interface AlliedVoucherItem {
  id: string;
  title: string;
  component: string;
  discountPercent: number;
  workshopName: string;
  validUntil: Date;
  description: string;
  couponCode: string;
}

export interface TcoResult {
  costPerKm: number;
  totalMaintenanceSpent: number;
  estimatedMarketValue: number;
  depreciationPercent: number;
}

export function calculatePredictiveHealth(
  activeMoto: TelemetryMotorcycleInput,
  intelligentEstimatedKm: number,
  inferredDailyRate: number,
  maintenanceLogs: Array<{
    odometerKm?: number;
    maintenanceType?: MaintenanceType | string;
    partsChanged?: string[];
  }>,
  isLegend: boolean,
): PredictiveHealthResult {
  const currentBaseKm = activeMoto.currentOdometerKm ?? 0;

  const lastOilLog = maintenanceLogs.find((m) =>
    hasPartIntervention(m, MaintenanceType.OIL_CHANGE, ["aceite"]),
  );
  const lastOilKm = lastOilLog?.odometerKm ?? currentBaseKm * 0.75;

  const lastChainLog = maintenanceLogs.find((m) =>
    hasPartIntervention(m, MaintenanceType.CHAIN_KIT, ["cadena", "arrastre"]),
  );
  const lastChainKm = lastChainLog?.odometerKm ?? currentBaseKm * 0.4;

  const lastBrakesLog = maintenanceLogs.find((m) =>
    hasPartIntervention(m, MaintenanceType.BRAKES, ["pastilla", "freno"]),
  );
  const lastBrakesKm = lastBrakesLog?.odometerKm ?? currentBaseKm * 0.6;

  const profile = (activeMoto.usageProfile ?? "daily_urban") as UsageProfile;
  const oilInterval = 4500 / (OIL_DEGRADATION[profile] ?? 1.0);
  const chainInterval = 22000 / (CHAIN_DEGRADATION[profile] ?? 1.0);
  const brakeInterval = 12000 / (BRAKE_DEGRADATION[profile] ?? 1.0);

  const kmSinceOil = Math.max(0, intelligentEstimatedKm - lastOilKm);
  const kmSinceChain = Math.max(0, intelligentEstimatedKm - lastChainKm);
  const kmSinceBrakes = Math.max(0, intelligentEstimatedKm - lastBrakesKm);

  const oilLifePercent = Math.max(
    0,
    Math.min(100, Math.round((1 - kmSinceOil / oilInterval) * 100)),
  );
  const chainLifePercent = Math.max(
    0,
    Math.min(100, Math.round((1 - kmSinceChain / chainInterval) * 100)),
  );
  const brakeLifePercent = Math.max(
    0,
    Math.min(100, Math.round((1 - kmSinceBrakes / brakeInterval) * 100)),
  );

  const oilRemainingKm = Math.max(0, Math.round(oilInterval - kmSinceOil));
  const chainRemainingKm = Math.max(
    0,
    Math.round(chainInterval - kmSinceChain),
  );
  const brakeRemainingKm = Math.max(
    0,
    Math.round(brakeInterval - kmSinceBrakes),
  );

  const oilRemainingDays = Math.max(
    0,
    Math.round(oilRemainingKm / inferredDailyRate),
  );
  const chainRemainingDays = Math.max(
    0,
    Math.round(chainRemainingKm / inferredDailyRate),
  );
  const brakeRemainingDays = Math.max(
    0,
    Math.round(brakeRemainingKm / inferredDailyRate),
  );

  return {
    brakeLifePercent,
    oilLifePercent,
    chainLifePercent,
    oilRemainingKm,
    report: {
      isLockedForFree: !isLegend,
      oil: {
        lifePercent: oilLifePercent,
        remainingKm: oilRemainingKm,
        remainingDays: oilRemainingDays,
        lastServiceKm: lastOilKm,
        status: getComponentHealthStatus(oilLifePercent),
      },
      chainKit: {
        lifePercent: chainLifePercent,
        remainingKm: chainRemainingKm,
        remainingDays: chainRemainingDays,
        lastServiceKm: lastChainKm,
        status: getComponentHealthStatus(chainLifePercent),
      },
      brakes: {
        lifePercent: brakeLifePercent,
        remainingKm: brakeRemainingKm,
        remainingDays: brakeRemainingDays,
        lastServiceKm: lastBrakesKm,
        status: getComponentHealthStatus(brakeLifePercent),
      },
    },
  };
}

export function generateAlliedVouchers(
  activeMoto: TelemetryMotorcycleInput,
  isLegend: boolean,
  health: {
    brakeLifePercent: number;
    oilLifePercent: number;
    chainLifePercent: number;
    oilRemainingKm: number;
  },
  workshopName = "BSK Central Performance",
): AlliedVoucherItem[] {
  const alliedVouchers: {
    id: string;
    title: string;
    component: string;
    discountPercent: number;
    workshopName: string;
    validUntil: Date;
    description: string;
    couponCode: string;
  }[] = [];

  const currentYear = new Date().getFullYear();

  if (health.brakeLifePercent <= 20) {
    alliedVouchers.push({
      id: "voucher-brakes-urgent",
      title: "Bono Pastillas de Freno",
      component: "Pastillas de Freno",
      discountPercent: isLegend ? 25 : 10,
      workshopName,
      validUntil: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
      description: `Tu desgaste de pastillas está al ${health.brakeLifePercent}%. Reserva con descuento exclusivo para tu ${activeMoto.brand} ${activeMoto.modelLine}.`,
      couponCode: `BSK-BRK-${activeMoto.plate}-${currentYear}`,
    });
  }

  if (health.oilLifePercent <= 20) {
    alliedVouchers.push({
      id: "voucher-oil-service",
      title: "Bono Cambio de Aceite",
      component: "Aceite de Motor",
      discountPercent: isLegend ? 20 : 10,
      workshopName,
      validUntil: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
      description: `Quedan aprox. ${health.oilRemainingKm} km de vida útil de lubricante. Servicio rápido con verificación oficial.`,
      couponCode: `BSK-OIL-${activeMoto.plate}-${currentYear}`,
    });
  }

  if (health.chainLifePercent <= 20) {
    alliedVouchers.push({
      id: "voucher-chain-kit",
      title: "Bono Kit de Arrastre",
      component: "Kit de Arrastre",
      discountPercent: isLegend ? 15 : 5,
      workshopName,
      validUntil: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
      description: `Desgaste detectado por telemetría. Alargue la vida de transmisión con cadena sellada X-Ring.`,
      couponCode: `BSK-CHN-${activeMoto.plate}-${currentYear}`,
    });
  }

  if (alliedVouchers.length === 0) {
    alliedVouchers.push({
      id: "voucher-preventive-allied",
      title: "Inspección Preventiva de Seguridad BSK",
      component: "Mantenimiento General",
      discountPercent: isLegend ? 20 : 10,
      workshopName,
      validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      description: `Revisión de 35 puntos de control de seguridad vial y escaneo computarizado para miembros del club.`,
      couponCode: `BSK-PRV-${activeMoto.plate}-${currentYear}`,
    });
  }

  return alliedVouchers;
}

export function calculateTcoAndMarketValue(
  activeMoto: TelemetryMotorcycleInput,
  intelligentEstimatedKm: number,
  maintenanceLogs: Array<{ cost?: number }>,
): TcoResult {
  let totalMaintenanceSpent = 0;
  for (const m of maintenanceLogs) {
    totalMaintenanceSpent += m.cost ?? 0;
  }

  const costPerKm = Math.round(
    totalMaintenanceSpent / Math.max(1, intelligentEstimatedKm),
  );

  const displacement = activeMoto.displacementCc ?? 250;
  const baseNewPrice = getBaseNewPrice(displacement);

  const brandKey = (activeMoto.brand ?? "").toLowerCase();
  const brandFactor = BRAND_MULTIPLIERS[brandKey] ?? 1.0;
  const currentYear = new Date().getFullYear();
  const ageYears = Math.max(0, currentYear - (activeMoto.year ?? currentYear));

  let depreciationFraction = 0.08;
  if (ageYears > 0) {
    depreciationFraction = Math.min(0.75, 0.16 + (ageYears - 1) * 0.075);
  }

  const estimatedMarketValue = Math.round(
    baseNewPrice * brandFactor * (1 - depreciationFraction),
  );

  return {
    costPerKm,
    totalMaintenanceSpent,
    estimatedMarketValue,
    depreciationPercent: Math.round(depreciationFraction * 100),
  };
}
