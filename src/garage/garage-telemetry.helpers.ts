import { Model } from "mongoose";
import {
  GarageMotorcycleDocument,
  UsageProfile,
} from "./schemas/garage-motorcycle.schema";
import type { OdometerLogDocument } from "./schemas/odometer-log.schema";
import { EventRegistrationDocument } from "../events/schemas/event-registration.schema";
import { EventDocument } from "../events/schemas/event.schema";
import { OrderDocument, OrderStatus } from "../shop/schemas/order.schema";
import {
  KNOWN_EVENT_KM,
  ALLIED_WORKSHOPS,
  PROFILE_DAILY_RATES,
  ProfileMotorcycleData,
} from "./garage.constants";
import {
  getDocumentStatus,
  calculateDaysRemaining,
  parseDateOrNull,
} from "./garage-calc.helpers";

export function buildEmptyDashboardResponse(isLegend: boolean) {
  return {
    hasVehicles: false,
    motorcycles: [],
    activeMotorcycle: null,
    telemetry: null,
    predictiveHealth: null,
    tco: null,
    documentAlerts: [],
    maintenanceLogs: [],
    alliedWorkshops: ALLIED_WORKSHOPS,
    alliedVouchers: [],
    tierLimits: {
      isLegend,
      maxVehicles: isLegend ? 10 : 1,
      hasFullPredictiveWear: isLegend,
      hasCertifiedServiceBook: isLegend,
      hasDirectAlliedDiscounts: isLegend,
    },
  };
}

export async function autoSeedFromProfile(
  motorcycleModel: Model<GarageMotorcycleDocument>,
  _odometerModel: Model<OdometerLogDocument>,
  user: { profile?: Record<string, unknown> },
  userId: string,
): Promise<void> {
  const profileMoto = user.profile?.["motocicleta"] as
    ProfileMotorcycleData | undefined;

  if (!profileMoto?.marcaMoto || !profileMoto?.placaMoto) {
    return;
  }

  const yearNum = Number(profileMoto.anioMoto);
  const displacementNum = Number(profileMoto.cilindraje);
  const validYear =
    Number.isNaN(yearNum) || yearNum <= 1900
      ? new Date().getFullYear()
      : yearNum;
  const validCc =
    Number.isNaN(displacementNum) || displacementNum <= 0
      ? 250
      : displacementNum;

  const seededMoto = new motorcycleModel({
    userId,
    brand: profileMoto.marcaMoto.trim(),
    modelLine: (profileMoto.lineaMoto || "").trim(),
    year: validYear,
    displacementCc: validCc,
    plate: profileMoto.placaMoto.trim().toUpperCase(),
    color: (profileMoto.colorMoto || "").trim(),
    motorcycleType: (profileMoto.tipoMoto || "").trim(),
    usageProfile: UsageProfile.DAILY_URBAN,
    currentOdometerKm: 0,
    odometerLastUpdatedAt: new Date(),
    soatExpiryDate: parseDateOrNull(profileMoto.soatVigencia),
    rtmExpiryDate: parseDateOrNull(profileMoto.tecnomecanicaVigencia),
    insuranceCompany: profileMoto.seguroTodoRiesgo?.trim() ?? null,
    policyNumber: profileMoto.polizaNumero?.trim() ?? null,
    vinOrEngineNumber: null,
    isPrimary: true,
  });

  await seededMoto.save();
}

export async function calculateClubTelemetry(
  eventRegistrationModel: Model<EventRegistrationDocument>,
  orderModel: Model<OrderDocument>,
  userId: string,
  eventModel?: Model<EventDocument>,
) {
  const confirmedRegistrations = await eventRegistrationModel
    .find({ userId, status: "CONFIRMED" })
    .lean();

  let totalClubRideKm = 0;
  if (confirmedRegistrations.length > 0) {
    const slugs = confirmedRegistrations.map((r) => r.eventSlug);
    const eventDocs = eventModel
      ? await eventModel
          .find({ slug: { $in: slugs } })
          .select("slug routeData metadata")
          .lean()
      : [];
    const eventMap = new Map(eventDocs.map((e) => [e.slug, e]));

    for (const reg of confirmedRegistrations) {
      const evt = eventMap.get(reg.eventSlug);
      const distance = Number(
        (evt?.routeData as Record<string, unknown> | undefined)?.distanceKm ??
          evt?.metadata?.distanceKm ??
          KNOWN_EVENT_KM[reg.eventSlug] ??
          0,
      );
      if (Number.isFinite(distance) && distance > 0) {
        totalClubRideKm += distance;
      }
    }
  }

  const shopOrders = await orderModel
    .find({
      userId,
      status: { $in: [OrderStatus.PAID, OrderStatus.DELIVERED] },
    })
    .lean();

  let platformOrdersCount = 0;
  for (const order of shopOrders) {
    if (order.items?.length) {
      platformOrdersCount += order.items.length;
    }
  }

  return {
    totalClubRideKm,
    confirmedRidesCount: confirmedRegistrations.length,
    platformOrdersCount,
  };
}

export interface OdometerEstimationResult {
  currentBaseKm: number;
  intelligentEstimatedKm: number;
  daysSinceLastUpdate: number;
  estimatedKmIncrement: number;
  inferredDailyRate: number;
  lastUpdateDate: Date;
}

export type NullableDate = Date | string | null;

export interface DocumentAlertItem {
  id: string;
  title: string;
  expiryDate?: NullableDate;
  daysRemaining: number | null;
  status: string;
  canRenewOneClick: boolean;
  isRuntVerified: boolean;
  runtVerifiedAt?: NullableDate;
  runtStatus?: string | null;
  insuranceCompany?: string | null;
  policyNumber?: string | null;
  cdaName?: string | null;
}

export interface TelemetryMotorcycleInput {
  currentOdometerKm?: number | null;
  odometerLastUpdatedAt?: NullableDate;
  usageProfile?: UsageProfile | string | null;
  soatExpiryDate?: NullableDate;
  rtmExpiryDate?: NullableDate;
  licenseExpiryDate?: NullableDate;
  isRuntVerified?: boolean | null;
  runtVerifiedAt?: NullableDate;
  runtSoatStatus?: string | null;
  runtRtmStatus?: string | null;
  runtCdaName?: string | null;
  insuranceCompany?: string | null;
  policyNumber?: string | null;
  brand?: string | null;
  modelLine?: string | null;
  plate?: string | null;
  year?: number | null;
  displacementCc?: number | null;
}

export type TelemetryOdometerLogInput = {
  odometerKm: number;
  recordedAt: Date | string;
};

export function calculateOdometerEstimation(
  activeMoto: TelemetryMotorcycleInput,
  odometerLogs: TelemetryOdometerLogInput[],
): OdometerEstimationResult {
  const currentBaseKm = activeMoto.currentOdometerKm ?? 0;
  const lastUpdateDate = activeMoto.odometerLastUpdatedAt
    ? new Date(activeMoto.odometerLastUpdatedAt)
    : new Date();

  const daysSinceLastUpdate = Math.max(
    0,
    Math.floor((Date.now() - lastUpdateDate.getTime()) / (1000 * 60 * 60 * 24)),
  );

  const profile = (activeMoto.usageProfile ?? "daily_urban") as UsageProfile;
  let inferredDailyRate = PROFILE_DAILY_RATES[profile] ?? 25.0;

  if (odometerLogs.length >= 2) {
    const latest = odometerLogs[0];
    const oldest = odometerLogs.at(-1);

    if (oldest) {
      const deltaKm = Math.max(0, latest.odometerKm - oldest.odometerKm);
      const deltaDays = Math.max(
        1,
        Math.floor(
          (new Date(latest.recordedAt).getTime() -
            new Date(oldest.recordedAt).getTime()) /
            (1000 * 60 * 60 * 24),
        ),
      );

      if (deltaDays >= 3 && deltaKm > 0) {
        const empiricalRate = deltaKm / deltaDays;
        inferredDailyRate = Math.round(
          0.7 * empiricalRate + 0.3 * inferredDailyRate,
        );
      }
    }
  }

  const estimatedKmIncrement = Math.round(
    daysSinceLastUpdate * inferredDailyRate,
  );
  const intelligentEstimatedKm = currentBaseKm + estimatedKmIncrement;

  return {
    currentBaseKm,
    intelligentEstimatedKm,
    daysSinceLastUpdate,
    estimatedKmIncrement,
    inferredDailyRate,
    lastUpdateDate,
  };
}

export function buildDocumentAlerts(
  activeMoto: TelemetryMotorcycleInput,
): DocumentAlertItem[] {
  const soatDays = calculateDaysRemaining(
    parseDateOrNull(activeMoto.soatExpiryDate),
  );
  const rtmDays = calculateDaysRemaining(
    parseDateOrNull(activeMoto.rtmExpiryDate),
  );
  const licenseDays = calculateDaysRemaining(
    parseDateOrNull(activeMoto.licenseExpiryDate),
  );

  return [
    {
      id: "soat",
      title: "SOAT Obligatorio",
      expiryDate: activeMoto.soatExpiryDate,
      daysRemaining: soatDays,
      status: getDocumentStatus(soatDays),
      canRenewOneClick: soatDays !== null && soatDays <= 15,
      isRuntVerified: activeMoto.isRuntVerified ?? false,
      runtVerifiedAt: activeMoto.runtVerifiedAt ?? null,
      runtStatus: activeMoto.runtSoatStatus ?? null,
      insuranceCompany: activeMoto.insuranceCompany ?? null,
      policyNumber: activeMoto.policyNumber ?? null,
    },
    {
      id: "rtm",
      title: "Revisión Técnico-Mecánica (RTM)",
      expiryDate: activeMoto.rtmExpiryDate,
      daysRemaining: rtmDays,
      status: getDocumentStatus(rtmDays),
      canRenewOneClick: rtmDays !== null && rtmDays <= 15,
      isRuntVerified: activeMoto.isRuntVerified ?? false,
      runtVerifiedAt: activeMoto.runtVerifiedAt ?? null,
      runtStatus: activeMoto.runtRtmStatus ?? null,
      cdaName: activeMoto.runtCdaName ?? null,
    },
    {
      id: "license",
      title: "Licencia de Conducción",
      expiryDate: activeMoto.licenseExpiryDate,
      daysRemaining: licenseDays,
      status: getDocumentStatus(licenseDays),
      canRenewOneClick: false,
      isRuntVerified: false,
      runtVerifiedAt: null,
      runtStatus: null,
      cdaName: null,
      insuranceCompany: null,
      policyNumber: null,
    },
  ];
}
