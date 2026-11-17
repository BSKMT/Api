import { NotFoundException } from "@nestjs/common";
import { Model } from "mongoose";
import type { GarageMotorcycleDocument } from "./schemas/garage-motorcycle.schema";
import type { MaintenanceLogDocument } from "./schemas/maintenance-log.schema";
import type { OdometerLogDocument } from "./schemas/odometer-log.schema";
import type { AlliedWorkshopDocument } from "./schemas/allied-workshop.schema";
import type { EventRegistrationDocument } from "../events/schemas/event-registration.schema";
import type { EventDocument } from "../events/schemas/event.schema";
import type { OrderDocument } from "../shop/schemas/order.schema";
import type { UsersService } from "../users/users.service";
import { ALLIED_WORKSHOPS } from "./garage.constants";
import {
  buildEmptyDashboardResponse,
  autoSeedFromProfile,
  calculateClubTelemetry,
  calculateOdometerEstimation,
  buildDocumentAlerts,
  type OdometerEstimationResult,
  type DocumentAlertItem,
} from "./garage-telemetry.helpers";
import {
  calculatePredictiveHealth,
  generateAlliedVouchers,
  calculateTcoAndMarketValue,
  type PredictiveHealthResult,
  type AlliedVoucherItem,
  type TcoResult,
} from "./garage-health.helpers";

export interface GarageDashboardModels {
  motorcycleModel: Model<GarageMotorcycleDocument>;
  maintenanceModel: Model<MaintenanceLogDocument>;
  odometerModel: Model<OdometerLogDocument>;
  eventRegistrationModel: Model<EventRegistrationDocument>;
  orderModel: Model<OrderDocument>;
  alliedWorkshopModel?: Model<AlliedWorkshopDocument>;
  eventModel?: Model<EventDocument>;
}

export async function executeGetDashboard(
  models: GarageDashboardModels,
  usersService: UsersService,
  userId: string,
  targetMotorcycleId?: string,
) {
  const {
    motorcycleModel,
    maintenanceModel,
    odometerModel,
    eventRegistrationModel,
    orderModel,
    alliedWorkshopModel,
    eventModel,
  } = models;
  const user = await usersService.findById(userId);
  if (!user) {
    throw new NotFoundException("Usuario no encontrado");
  }

  const isLegend = user.membershipLevel === "Legend";

  let motorcycles = await motorcycleModel
    .find({ userId })
    .sort({ isPrimary: -1, createdAt: 1 })
    .lean();

  if (motorcycles.length === 0) {
    await autoSeedFromProfile(motorcycleModel, odometerModel, user, userId);
    motorcycles = await motorcycleModel
      .find({ userId })
      .sort({ isPrimary: -1, createdAt: 1 })
      .lean();
  }

  if (motorcycles.length === 0) {
    return buildEmptyDashboardResponse(isLegend);
  }

  const activeMoto = targetMotorcycleId
    ? (motorcycles.find((m) => String(m._id) === targetMotorcycleId) ??
      motorcycles[0])
    : motorcycles[0];

  const motoId = String(activeMoto._id);

  const telemetry = await calculateClubTelemetry(
    eventRegistrationModel,
    orderModel,
    userId,
    eventModel,
  );
  const [maintenanceLogs, odometerLogs, dbWorkshops] = await Promise.all([
    maintenanceModel.find({ motorcycleId: motoId }).sort({ date: -1 }).lean(),
    odometerModel
      .find({ motorcycleId: motoId })
      .sort({ recordedAt: -1 })
      .limit(10)
      .lean(),
    alliedWorkshopModel
      ? alliedWorkshopModel.find({ isActive: true }).lean().exec()
      : Promise.resolve([]),
  ]);

  const activeWorkshops =
    dbWorkshops && dbWorkshops.length > 0 ? dbWorkshops : ALLIED_WORKSHOPS;

  const odoData: OdometerEstimationResult = calculateOdometerEstimation(
    activeMoto,
    odometerLogs,
  );
  const predictiveHealth: PredictiveHealthResult = calculatePredictiveHealth(
    activeMoto,
    odoData.intelligentEstimatedKm,
    odoData.inferredDailyRate,
    maintenanceLogs,
    isLegend,
  );
  const defaultWorkshopName =
    activeWorkshops[0]?.name ?? "BSK Central Performance";
  const alliedVouchers: AlliedVoucherItem[] = generateAlliedVouchers(
    activeMoto,
    isLegend,
    predictiveHealth,
    defaultWorkshopName,
  );
  const tco: TcoResult = calculateTcoAndMarketValue(
    activeMoto,
    odoData.intelligentEstimatedKm,
    maintenanceLogs,
  );
  const documentAlerts: DocumentAlertItem[] = buildDocumentAlerts(activeMoto);

  return {
    hasVehicles: true,
    motorcycles,
    activeMotorcycle: activeMoto,
    telemetry: {
      currentOdometerKm: odoData.currentBaseKm,
      intelligentEstimatedKm: odoData.intelligentEstimatedKm,
      daysSinceLastUpdate: odoData.daysSinceLastUpdate,
      estimatedKmIncrement: odoData.estimatedKmIncrement,
      inferredDailyRate: odoData.inferredDailyRate,
      totalClubRideKm: telemetry.totalClubRideKm,
      completedRidesCount: telemetry.confirmedRidesCount,
      platformOrdersCount: telemetry.platformOrdersCount,
      lastCheckInDate: odoData.lastUpdateDate,
    },
    predictiveHealth: predictiveHealth.report,
    tco,
    documentAlerts,
    maintenanceLogs,
    alliedWorkshops: activeWorkshops,
    alliedVouchers,
    tierLimits: {
      isLegend,
      maxVehicles: isLegend ? 10 : 1,
      hasFullPredictiveWear: isLegend,
      hasCertifiedServiceBook: isLegend,
      hasDirectAlliedDiscounts: isLegend,
    },
  };
}
