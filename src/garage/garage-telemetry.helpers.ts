import { Model } from "mongoose";
import {
  GarageMotorcycle,
  GarageMotorcycleDocument,
  UsageProfile,
} from "./schemas/garage-motorcycle.schema";
import {
  OdometerLog,
  OdometerSource,
  OdometerLogDocument,
} from "./schemas/odometer-log.schema";
import { EventRegistrationDocument } from "../events/schemas/event-registration.schema";
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
  odometerModel: Model<OdometerLogDocument>,
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
    modelLine: (profileMoto.lineaMoto ?? "Modelo Base").trim(),
    year: validYear,
    displacementCc: validCc,
    plate: profileMoto.placaMoto.trim().toUpperCase(),
    color: (profileMoto.colorMoto ?? "Negro").trim(),
    motorcycleType: (profileMoto.tipoMoto ?? "Naked").trim(),
    usageProfile: UsageProfile.DAILY_URBAN,
    currentOdometerKm: 12500,
    odometerLastUpdatedAt: new Date(),
    soatExpiryDate: parseDateOrNull(profileMoto.soatVigencia),
    rtmExpiryDate: parseDateOrNull(profileMoto.tecnomecanicaVigencia),
    insuranceCompany: profileMoto.seguroTodoRiesgo?.trim() ?? null,
    policyNumber: profileMoto.polizaNumero?.trim() ?? null,
    isPrimary: true,
  });

  const saved = await seededMoto.save();
  await odometerModel.create({
    userId,
    motorcycleId: String(saved._id),
    odometerKm: 12500,
    recordedAt: new Date(),
    source: OdometerSource.MANUAL_QUICK,
  });
}

export async function calculateClubTelemetry(
  eventRegistrationModel: Model<EventRegistrationDocument>,
  orderModel: Model<OrderDocument>,
  userId: string,
) {
  const confirmedRegistrations = await eventRegistrationModel
    .find({ userId, status: "CONFIRMED" })
    .lean();

  let totalClubRideKm = 0;
  for (const reg of confirmedRegistrations) {
    const km = KNOWN_EVENT_KM[reg.eventSlug] ?? 100;
    totalClubRideKm += km;
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

export function calculateOdometerEstimation(
  activeMoto: GarageMotorcycle,
  odometerLogs: OdometerLog[],
) {
  const currentBaseKm = activeMoto.currentOdometerKm ?? 0;
  const lastUpdateDate = activeMoto.odometerLastUpdatedAt
    ? new Date(activeMoto.odometerLastUpdatedAt)
    : new Date();

  const daysSinceLastUpdate = Math.max(
    0,
    Math.floor((Date.now() - lastUpdateDate.getTime()) / (1000 * 60 * 60 * 24)),
  );

  let inferredDailyRate = PROFILE_DAILY_RATES[activeMoto.usageProfile] ?? 25.0;

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

export function buildDocumentAlerts(activeMoto: GarageMotorcycle) {
  const soatDays = calculateDaysRemaining(activeMoto.soatExpiryDate);
  const rtmDays = calculateDaysRemaining(activeMoto.rtmExpiryDate);
  const licenseDays = calculateDaysRemaining(activeMoto.licenseExpiryDate);

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
