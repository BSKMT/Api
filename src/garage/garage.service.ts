import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
  Logger,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { randomBytes } from "node:crypto";
import {
  GarageMotorcycle,
  GarageMotorcycleDocument,
  UsageProfile,
} from "./schemas/garage-motorcycle.schema";
import {
  MaintenanceLog,
  MaintenanceLogDocument,
  MaintenanceSource,
  MaintenanceType,
} from "./schemas/maintenance-log.schema";
import {
  OdometerLog,
  OdometerLogDocument,
  OdometerSource,
} from "./schemas/odometer-log.schema";
import {
  EventRegistration,
  EventRegistrationDocument,
} from "../events/schemas/event-registration.schema";
import {
  Order,
  OrderDocument,
  OrderStatus,
} from "../shop/schemas/order.schema";
import { UsersService } from "../users/users.service";
import { CreateMotorcycleDto } from "./dto/create-motorcycle.dto";
import { UpdateMotorcycleDto } from "./dto/update-motorcycle.dto";
import { UpdateOdometerDto } from "./dto/update-odometer.dto";
import { CreateMaintenanceDto } from "./dto/create-maintenance.dto";
import { AlliedServiceOrderDto } from "./dto/allied-service-order.dto";

const KNOWN_EVENT_KM: Record<string, number> = {
  "kick-off-2026": 120,
  "rally-fundadores": 1800,
  "distinguished-ride": 45,
  "track-day-bsk": 150,
  "aniversario-gala-bsk": 90,
  "last-ride-2026": 140,
  "peregrinaje-motero": 650,
  "ruta-del-corazon": 240,
  "ruta-libertadora": 380,
  "rodada-nocturna": 80,
};

const ALLIED_WORKSHOPS = [
  {
    id: "bsk-central",
    name: "BSK Central Performance",
    address: "Cra 7 # 73-28, Bogotá",
    city: "Bogotá",
    phone: "+57 310 890 1234",
    services: [
      "Mantenimiento General",
      "Cambio de Aceite",
      "Sincronización",
      "Frenos",
    ],
    discountPercent: 20,
    isAlliedCertified: true,
  },
  {
    id: "motos-accesorios-norte",
    name: "Motos & Accesorios SAS — Taller Norte",
    address: "Autopista Norte # 145-20, Bogotá",
    city: "Bogotá",
    phone: "+57 320 456 7890",
    services: ["Kit de Arrastre", "Pastillas Brembo", "Llantas Pirelli"],
    discountPercent: 15,
    isAlliedCertified: true,
  },
  {
    id: "box54-chia",
    name: "Box 54 Taller Especializado",
    address: "Av. Pradilla # 4-80, Chía",
    city: "Chía / Sabana",
    phone: "+57 315 234 5678",
    services: ["Suspensiones", "Diagnóstico Computarizado", "Mantenimiento"],
    discountPercent: 15,
    isAlliedCertified: true,
  },
  {
    id: "brembo-racing-point",
    name: "Brembo Official Service Partner",
    address: "Calle 127 # 19-35, Bogotá",
    city: "Bogotá",
    phone: "+57 312 345 6789",
    services: ["Pastillas Sinterizadas", "Líquido DOT 5.1", "Discos"],
    discountPercent: 25,
    isAlliedCertified: true,
  },
];

const PROFILE_DAILY_RATES: Record<UsageProfile, number> = {
  [UsageProfile.DAILY_URBAN]: 28.5,
  [UsageProfile.WEEKEND_TRIPS]: 18.0,
  [UsageProfile.OFF_ROAD]: 12.0,
  [UsageProfile.CIRCUIT]: 8.0,
};

const OIL_DEGRADATION: Record<UsageProfile, number> = {
  [UsageProfile.DAILY_URBAN]: 1.15,
  [UsageProfile.WEEKEND_TRIPS]: 0.95,
  [UsageProfile.OFF_ROAD]: 1.3,
  [UsageProfile.CIRCUIT]: 1.55,
};

const CHAIN_DEGRADATION: Record<UsageProfile, number> = {
  [UsageProfile.DAILY_URBAN]: 1.1,
  [UsageProfile.WEEKEND_TRIPS]: 0.9,
  [UsageProfile.OFF_ROAD]: 1.45,
  [UsageProfile.CIRCUIT]: 1.25,
};

const BRAKE_DEGRADATION: Record<UsageProfile, number> = {
  [UsageProfile.DAILY_URBAN]: 1.3,
  [UsageProfile.WEEKEND_TRIPS]: 0.9,
  [UsageProfile.OFF_ROAD]: 1.15,
  [UsageProfile.CIRCUIT]: 1.6,
};

const BRAND_MULTIPLIERS: Record<string, number> = {
  bmw: 1.35,
  ducati: 1.3,
  ktm: 1.15,
  triumph: 1.2,
  yamaha: 1.1,
  honda: 1.1,
  kawasaki: 1.1,
  suzuki: 1.0,
  bajaj: 0.85,
  akt: 0.8,
};

interface ProfileMotorcycleData {
  marcaMoto?: string;
  lineaMoto?: string;
  anioMoto?: number | string;
  cilindraje?: number | string;
  placaMoto?: string;
  colorMoto?: string;
  tipoMoto?: string;
  soatVigencia?: string;
  tecnomecanicaVigencia?: string;
  seguroTodoRiesgo?: string;
  polizaNumero?: string;
}

function getDocumentStatus(
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

function getComponentHealthStatus(
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

function calculateDaysRemaining(date: Date | null | undefined): number | null {
  if (!date) {
    return null;
  }
  const now = new Date();
  return Math.ceil(
    (new Date(date).getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
  );
}

function parseDateOrNull(val: string | Date | null | undefined): Date | null {
  if (!val) {
    return null;
  }
  return new Date(val);
}

function hasPartIntervention(
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

function getBaseNewPrice(displacement: number): number {
  if (displacement >= 1000) return 85000000;
  if (displacement >= 700) return 58000000;
  if (displacement >= 450) return 38000000;
  if (displacement >= 300) return 28000000;
  if (displacement >= 200) return 18000000;
  return 12000000;
}

@Injectable()
export class GarageService {
  private readonly logger = new Logger(GarageService.name);

  constructor(
    @InjectModel(GarageMotorcycle.name)
    private readonly motorcycleModel: Model<GarageMotorcycleDocument>,
    @InjectModel(MaintenanceLog.name)
    private readonly maintenanceModel: Model<MaintenanceLogDocument>,
    @InjectModel(OdometerLog.name)
    private readonly odometerModel: Model<OdometerLogDocument>,
    @InjectModel(EventRegistration.name)
    private readonly eventRegistrationModel: Model<EventRegistrationDocument>,
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
    private readonly usersService: UsersService,
  ) {}

  async getDashboard(userId: string, targetMotorcycleId?: string) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new NotFoundException("Usuario no encontrado");
    }

    const isLegend = user.membershipLevel === "Legend";

    let motorcycles = await this.motorcycleModel
      .find({ userId })
      .sort({ isPrimary: -1, createdAt: 1 })
      .lean();

    if (motorcycles.length === 0) {
      await this.autoSeedFromProfile(user, userId);
      motorcycles = await this.motorcycleModel
        .find({ userId })
        .sort({ isPrimary: -1, createdAt: 1 })
        .lean();
    }

    if (motorcycles.length === 0) {
      return this.buildEmptyDashboardResponse(isLegend);
    }

    const activeMoto = targetMotorcycleId
      ? (motorcycles.find((m) => String(m._id) === targetMotorcycleId) ??
        motorcycles[0])
      : motorcycles[0];

    const motoId = String(activeMoto._id);

    const telemetry = await this.calculateClubTelemetry(userId);
    const [maintenanceLogs, odometerLogs] = await Promise.all([
      this.maintenanceModel
        .find({ motorcycleId: motoId })
        .sort({ date: -1 })
        .lean(),
      this.odometerModel
        .find({ motorcycleId: motoId })
        .sort({ recordedAt: -1 })
        .limit(10)
        .lean(),
    ]);

    const odoData = this.calculateOdometerEstimation(activeMoto, odometerLogs);
    const predictiveHealth = this.calculatePredictiveHealth(
      activeMoto,
      odoData.intelligentEstimatedKm,
      odoData.inferredDailyRate,
      maintenanceLogs,
      isLegend,
    );
    const alliedVouchers = this.generateAlliedVouchers(
      activeMoto,
      isLegend,
      predictiveHealth,
    );
    const tco = this.calculateTcoAndMarketValue(
      activeMoto,
      odoData.intelligentEstimatedKm,
      maintenanceLogs,
    );
    const documentAlerts = this.buildDocumentAlerts(activeMoto);

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
      alliedWorkshops: ALLIED_WORKSHOPS,
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

  private buildEmptyDashboardResponse(isLegend: boolean) {
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

  private async autoSeedFromProfile(
    user: { profile?: Record<string, unknown> },
    userId: string,
  ): Promise<void> {
    const profileMoto = user.profile?.["motocicleta"] as
      | ProfileMotorcycleData
      | undefined;

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

    const seededMoto = new this.motorcycleModel({
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
    await this.odometerModel.create({
      userId,
      motorcycleId: String(saved._id),
      odometerKm: 12500,
      recordedAt: new Date(),
      source: OdometerSource.MANUAL_QUICK,
    });
  }

  private async calculateClubTelemetry(userId: string) {
    const confirmedRegistrations = await this.eventRegistrationModel
      .find({ userId, status: "CONFIRMED" })
      .lean();

    let totalClubRideKm = 0;
    for (const reg of confirmedRegistrations) {
      const km = KNOWN_EVENT_KM[reg.eventSlug] ?? 100;
      totalClubRideKm += km;
    }

    const shopOrders = await this.orderModel
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

  private calculateOdometerEstimation(
    activeMoto: GarageMotorcycle,
    odometerLogs: OdometerLog[],
  ) {
    const currentBaseKm = activeMoto.currentOdometerKm ?? 0;
    const lastUpdateDate = activeMoto.odometerLastUpdatedAt
      ? new Date(activeMoto.odometerLastUpdatedAt)
      : new Date();

    const daysSinceLastUpdate = Math.max(
      0,
      Math.floor(
        (Date.now() - lastUpdateDate.getTime()) / (1000 * 60 * 60 * 24),
      ),
    );

    let inferredDailyRate =
      PROFILE_DAILY_RATES[activeMoto.usageProfile] ?? 25.0;

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

  private calculatePredictiveHealth(
    activeMoto: GarageMotorcycle,
    intelligentEstimatedKm: number,
    inferredDailyRate: number,
    maintenanceLogs: MaintenanceLog[],
    isLegend: boolean,
  ) {
    const currentBaseKm = activeMoto.currentOdometerKm ?? 0;

    const lastOilLog = maintenanceLogs.find((m) =>
      hasPartIntervention(m, MaintenanceType.OIL_CHANGE, ["aceite"]),
    );
    const lastOilKm = lastOilLog ? lastOilLog.odometerKm : currentBaseKm * 0.75;

    const lastChainLog = maintenanceLogs.find((m) =>
      hasPartIntervention(m, MaintenanceType.CHAIN_KIT, ["cadena", "arrastre"]),
    );
    const lastChainKm = lastChainLog
      ? lastChainLog.odometerKm
      : currentBaseKm * 0.4;

    const lastBrakesLog = maintenanceLogs.find((m) =>
      hasPartIntervention(m, MaintenanceType.BRAKES, ["pastilla", "freno"]),
    );
    const lastBrakesKm = lastBrakesLog
      ? lastBrakesLog.odometerKm
      : currentBaseKm * 0.6;

    const oilInterval =
      4500 / (OIL_DEGRADATION[activeMoto.usageProfile] ?? 1.0);
    const chainInterval =
      22000 / (CHAIN_DEGRADATION[activeMoto.usageProfile] ?? 1.0);
    const brakeInterval =
      12000 / (BRAKE_DEGRADATION[activeMoto.usageProfile] ?? 1.0);

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

  private generateAlliedVouchers(
    activeMoto: GarageMotorcycle,
    isLegend: boolean,
    health: {
      brakeLifePercent: number;
      oilLifePercent: number;
      chainLifePercent: number;
      oilRemainingKm: number;
    },
  ) {
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

    if (health.brakeLifePercent <= 20) {
      alliedVouchers.push({
        id: "voucher-brakes-urgent",
        title: "Bono Preferencial Pastillas Brembo",
        component: "Pastillas de Freno",
        discountPercent: isLegend ? 25 : 10,
        workshopName: "Brembo Official Service Partner",
        validUntil: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
        description: `Tu desgaste de pastillas está al ${health.brakeLifePercent}%. Reserva con descuento exclusivo para tu ${activeMoto.brand} ${activeMoto.modelLine}.`,
        couponCode: `BREMBO-${activeMoto.plate}-2026`,
      });
    }

    if (health.oilLifePercent <= 20) {
      alliedVouchers.push({
        id: "voucher-oil-service",
        title: "Bono Cambio de Aceite Sintético BSK",
        component: "Aceite de Motor",
        discountPercent: isLegend ? 20 : 10,
        workshopName: "BSK Central Performance",
        validUntil: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
        description: `Quedan aprox. ${health.oilRemainingKm} km de vida útil de lubricante. Servicio rápido con verificación oficial.`,
        couponCode: `OILBSK-${activeMoto.plate}-2026`,
      });
    }

    if (health.chainLifePercent <= 20) {
      alliedVouchers.push({
        id: "voucher-chain-kit",
        title: "Bono Kit de Arrastre Reforzado",
        component: "Kit de Arrastre",
        discountPercent: isLegend ? 15 : 5,
        workshopName: "Motos & Accesorios SAS — Taller Norte",
        validUntil: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
        description: `Desgaste detectado por telemetría. Alargue la vida de transmisión con cadena sellada X-Ring.`,
        couponCode: `CHAIN-${activeMoto.plate}-2026`,
      });
    }

    if (alliedVouchers.length === 0) {
      alliedVouchers.push({
        id: "voucher-preventive-allied",
        title: "Inspección Preventiva de Seguridad BSK",
        component: "Mantenimiento General",
        discountPercent: isLegend ? 20 : 10,
        workshopName: "BSK Central Performance",
        validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        description: `Revisión de 35 puntos de control de seguridad vial y escaneo computarizado para miembros del club.`,
        couponCode: `BSKSAFE-${activeMoto.plate}-2026`,
      });
    }

    return alliedVouchers;
  }

  private calculateTcoAndMarketValue(
    activeMoto: GarageMotorcycle,
    intelligentEstimatedKm: number,
    maintenanceLogs: MaintenanceLog[],
  ) {
    let totalMaintenanceSpent = 0;
    for (const m of maintenanceLogs) {
      totalMaintenanceSpent += m.cost ?? 0;
    }

    const costPerKm = Math.round(
      totalMaintenanceSpent / Math.max(1, intelligentEstimatedKm),
    );

    const displacement = activeMoto.displacementCc ?? 250;
    const baseNewPrice = getBaseNewPrice(displacement);

    const brandKey = activeMoto.brand.toLowerCase();
    const brandFactor = BRAND_MULTIPLIERS[brandKey] ?? 1.0;
    const currentYear = new Date().getFullYear();
    const ageYears = Math.max(
      0,
      currentYear - (activeMoto.year ?? currentYear),
    );

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

  private buildDocumentAlerts(activeMoto: GarageMotorcycle) {
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
      },
      {
        id: "rtm",
        title: "Revisión Técnico-Mecánica (RTM)",
        expiryDate: activeMoto.rtmExpiryDate,
        daysRemaining: rtmDays,
        status: getDocumentStatus(rtmDays),
        canRenewOneClick: rtmDays !== null && rtmDays <= 15,
      },
      {
        id: "license",
        title: "Licencia de Conducción",
        expiryDate: activeMoto.licenseExpiryDate,
        daysRemaining: licenseDays,
        status: getDocumentStatus(licenseDays),
        canRenewOneClick: false,
      },
    ];
  }

  async createMotorcycle(userId: string, dto: CreateMotorcycleDto) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new NotFoundException("Usuario no encontrado");
    }

    const isLegend = user.membershipLevel === "Legend";
    const currentCount = await this.motorcycleModel.countDocuments({ userId });

    if (!isLegend && currentCount >= 1) {
      throw new BadRequestException(
        "Límite de vehículos alcanzado para cuenta gratuita (1 moto). Actualiza a membresía Legend para garaje extendido.",
      );
    }

    const normalizedPlate = dto.plate.trim().toUpperCase();
    const existing = await this.motorcycleModel.findOne({
      userId,
      plate: normalizedPlate,
    });
    if (existing) {
      throw new BadRequestException(
        `Ya tienes una motocicleta registrada con la placa ${normalizedPlate}`,
      );
    }

    const newMoto = new this.motorcycleModel({
      userId,
      brand: dto.brand.trim(),
      modelLine: dto.modelLine.trim(),
      year: dto.year,
      displacementCc: dto.displacementCc,
      plate: normalizedPlate,
      vinOrEngineNumber: dto.vinOrEngineNumber?.trim() ?? null,
      nickname: dto.nickname?.trim() ?? null,
      color: dto.color?.trim() ?? "Negro",
      motorcycleType: dto.motorcycleType?.trim() ?? "Naked",
      usageProfile: dto.usageProfile,
      currentOdometerKm: dto.currentOdometerKm,
      odometerLastUpdatedAt: new Date(),
      soatExpiryDate: parseDateOrNull(dto.soatExpiryDate),
      rtmExpiryDate: parseDateOrNull(dto.rtmExpiryDate),
      licenseExpiryDate: parseDateOrNull(dto.licenseExpiryDate),
      insuranceCompany: dto.insuranceCompany?.trim() ?? null,
      policyNumber: dto.policyNumber?.trim() ?? null,
      isPrimary: currentCount === 0,
    });

    const saved = await newMoto.save();

    await this.odometerModel.create({
      userId,
      motorcycleId: String(saved._id),
      odometerKm: dto.currentOdometerKm,
      recordedAt: new Date(),
      source: OdometerSource.MANUAL_QUICK,
    });

    this.logger.log(`Motorcycle created for user ${userId}: ${saved.plate}`);
    return saved;
  }

  async updateMotorcycle(
    userId: string,
    motorcycleId: string,
    dto: UpdateMotorcycleDto,
  ) {
    const moto = await this.motorcycleModel.findOne({
      _id: motorcycleId,
      userId,
    });
    if (!moto) {
      throw new NotFoundException("Motocicleta no encontrada");
    }

    this.applyBasicSpecsUpdates(moto, dto);
    this.applyOptionalDetailsUpdates(moto, dto);
    this.applyDocumentDateUpdates(moto, dto);

    if (
      dto.currentOdometerKm !== undefined &&
      dto.currentOdometerKm !== moto.currentOdometerKm
    ) {
      moto.currentOdometerKm = dto.currentOdometerKm;
      moto.odometerLastUpdatedAt = new Date();
      await this.odometerModel.create({
        userId,
        motorcycleId,
        odometerKm: dto.currentOdometerKm,
        recordedAt: new Date(),
        source: OdometerSource.MANUAL_QUICK,
      });
    }

    return moto.save();
  }

  private applyBasicSpecsUpdates(
    moto: GarageMotorcycleDocument,
    dto: UpdateMotorcycleDto,
  ): void {
    if (dto.brand !== undefined) moto.brand = dto.brand.trim();
    if (dto.modelLine !== undefined) moto.modelLine = dto.modelLine.trim();
    if (dto.year !== undefined) moto.year = dto.year;
    if (dto.displacementCc !== undefined)
      moto.displacementCc = dto.displacementCc;
    if (dto.plate !== undefined) moto.plate = dto.plate.trim().toUpperCase();
    if (dto.color !== undefined) moto.color = dto.color.trim();
    if (dto.motorcycleType !== undefined)
      moto.motorcycleType = dto.motorcycleType.trim();
    if (dto.usageProfile !== undefined) moto.usageProfile = dto.usageProfile;
  }

  private applyOptionalDetailsUpdates(
    moto: GarageMotorcycleDocument,
    dto: UpdateMotorcycleDto,
  ): void {
    if (dto.vinOrEngineNumber !== undefined) {
      moto.vinOrEngineNumber = dto.vinOrEngineNumber?.trim() ?? null;
    }
    if (dto.nickname !== undefined) {
      moto.nickname = dto.nickname?.trim() ?? null;
    }
    if (dto.insuranceCompany !== undefined) {
      moto.insuranceCompany = dto.insuranceCompany?.trim() ?? null;
    }
    if (dto.policyNumber !== undefined) {
      moto.policyNumber = dto.policyNumber?.trim() ?? null;
    }
  }

  private applyDocumentDateUpdates(
    moto: GarageMotorcycleDocument,
    dto: UpdateMotorcycleDto,
  ): void {
    if (dto.soatExpiryDate !== undefined) {
      moto.soatExpiryDate = parseDateOrNull(dto.soatExpiryDate);
    }
    if (dto.rtmExpiryDate !== undefined) {
      moto.rtmExpiryDate = parseDateOrNull(dto.rtmExpiryDate);
    }
    if (dto.licenseExpiryDate !== undefined) {
      moto.licenseExpiryDate = parseDateOrNull(dto.licenseExpiryDate);
    }
  }

  async deleteMotorcycle(userId: string, motorcycleId: string) {
    const moto = await this.motorcycleModel.findOne({
      _id: motorcycleId,
      userId,
    });
    if (!moto) {
      throw new NotFoundException("Motocicleta no encontrada");
    }

    await this.motorcycleModel.deleteOne({ _id: motorcycleId });
    await this.maintenanceModel.deleteMany({ motorcycleId });
    await this.odometerModel.deleteMany({ motorcycleId });

    return { success: true, message: "Motocicleta eliminada del garaje" };
  }

  async updateOdometer(
    userId: string,
    motorcycleId: string,
    dto: UpdateOdometerDto,
  ) {
    const moto = await this.motorcycleModel.findOne({
      _id: motorcycleId,
      userId,
    });
    if (!moto) {
      throw new NotFoundException("Motocicleta no encontrada");
    }

    if (dto.odometerKm < moto.currentOdometerKm) {
      throw new BadRequestException(
        `El nuevo kilometraje (${dto.odometerKm} km) no puede ser inferior al registrado previamente (${moto.currentOdometerKm} km)`,
      );
    }

    moto.currentOdometerKm = dto.odometerKm;
    moto.odometerLastUpdatedAt = new Date();
    await moto.save();

    const log = await this.odometerModel.create({
      userId,
      motorcycleId,
      odometerKm: dto.odometerKm,
      recordedAt: new Date(),
      source: dto.source ?? OdometerSource.MANUAL_QUICK,
      referenceId: dto.referenceId ?? null,
    });

    return {
      success: true,
      currentOdometerKm: moto.currentOdometerKm,
      odometerLastUpdatedAt: moto.odometerLastUpdatedAt,
      logId: log._id,
    };
  }

  async createMaintenance(
    userId: string,
    motorcycleId: string,
    dto: CreateMaintenanceDto,
  ) {
    const moto = await this.motorcycleModel.findOne({
      _id: motorcycleId,
      userId,
    });
    if (!moto) {
      throw new NotFoundException("Motocicleta no encontrada");
    }

    const log = new this.maintenanceModel({
      userId,
      motorcycleId,
      date: new Date(dto.date),
      odometerKm: dto.odometerKm,
      maintenanceType: dto.maintenanceType,
      workshop: dto.workshop.trim(),
      partsChanged: dto.partsChanged ?? [],
      oilType: dto.oilType?.trim() ?? null,
      cost: dto.cost,
      invoiceNumber: dto.invoiceNumber?.trim() ?? null,
      notes: dto.notes?.trim() ?? "",
      isAlliedVerified: false,
      source: MaintenanceSource.MANUAL_USER,
    });

    const saved = await log.save();

    if (dto.odometerKm > moto.currentOdometerKm) {
      moto.currentOdometerKm = dto.odometerKm;
      moto.odometerLastUpdatedAt = new Date(dto.date);
      await moto.save();
    }

    return saved;
  }

  async recordAlliedServiceOrder(dto: AlliedServiceOrderDto) {
    const validTokens = ["BSK-PARTNER-WORKSHOP-2026", "BSK-ALLIED-SECRET"];
    if (!validTokens.includes(dto.workshopAuthToken)) {
      throw new UnauthorizedException(
        "Token de autorización de taller aliado inválido",
      );
    }

    const moto = await this.motorcycleModel.findOne({
      _id: dto.motorcycleId,
      userId: dto.targetUserId,
    });
    if (!moto) {
      throw new NotFoundException("Motocicleta de miembro no encontrada");
    }

    const randomSuffix = randomBytes(3).toString("hex").toUpperCase();
    const verificationCode = `BSK-CERT-${new Date().getFullYear()}-${randomSuffix}`;

    const log = new this.maintenanceModel({
      userId: dto.targetUserId,
      motorcycleId: dto.motorcycleId,
      date: new Date(),
      odometerKm: dto.odometerKm,
      maintenanceType: dto.maintenanceType,
      workshop: dto.alliedWorkshopName.trim(),
      partsChanged: dto.partsChanged,
      oilType: dto.oilType?.trim() ?? null,
      cost: dto.cost,
      invoiceNumber: dto.invoiceNumber?.trim() ?? null,
      notes: dto.notes?.trim() ?? "Servicio certificado por la red BSK",
      isAlliedVerified: true,
      alliedWorkshopName: dto.alliedWorkshopName.trim(),
      alliedVerificationCode: verificationCode,
      alliedVerifiedAt: new Date(),
      source: MaintenanceSource.ALLIED_CERTIFIED,
    });

    const saved = await log.save();

    if (dto.odometerKm > moto.currentOdometerKm) {
      moto.currentOdometerKm = dto.odometerKm;
      moto.odometerLastUpdatedAt = new Date();
      await moto.save();
      await this.odometerModel.create({
        userId: dto.targetUserId,
        motorcycleId: dto.motorcycleId,
        odometerKm: dto.odometerKm,
        recordedAt: new Date(),
        source: OdometerSource.SERVICE_ORDER,
        referenceId: verificationCode,
      });
    }

    this.logger.log(
      `Allied service order registered: ${verificationCode} for moto ${moto.plate}`,
    );

    return {
      success: true,
      verificationCode,
      log: saved,
    };
  }

  getAlliedWorkshops() {
    return ALLIED_WORKSHOPS;
  }
}
