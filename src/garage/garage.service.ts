import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import {
  GarageMotorcycle,
  GarageMotorcycleDocument,
} from "./schemas/garage-motorcycle.schema";
import {
  MaintenanceLog,
  MaintenanceLogDocument,
} from "./schemas/maintenance-log.schema";
import {
  OdometerLog,
  OdometerLogDocument,
} from "./schemas/odometer-log.schema";
import {
  EventRegistration,
  EventRegistrationDocument,
} from "../events/schemas/event-registration.schema";
import { Order, OrderDocument } from "../shop/schemas/order.schema";
import { UsersService } from "../users/users.service";
import { CreateMotorcycleDto } from "./dto/create-motorcycle.dto";
import { UpdateMotorcycleDto } from "./dto/update-motorcycle.dto";
import { UpdateOdometerDto } from "./dto/update-odometer.dto";
import { CreateMaintenanceDto } from "./dto/create-maintenance.dto";
import { AlliedServiceOrderDto } from "./dto/allied-service-order.dto";
import { VerifyRuntDto } from "./dto/verify-runt.dto";
import { VerifikService } from "../verifik/verifik.service";
import { KvCacheService } from "../kv/kv-cache.service";
import { ALLIED_WORKSHOPS } from "./garage.constants";
import { executeGetDashboard } from "./garage-dashboard.helpers";
import {
  executeCreateMotorcycle,
  executeUpdateMotorcycle,
  executeUpdateOdometer,
} from "./garage-crud.helpers";
import {
  executeCreateMaintenance,
  executeRecordAlliedServiceOrder,
} from "./garage-maintenance.helpers";
import {
  executeVerifyMotorcycleWithRunt,
  executeSyncMotorcycleWithVerifik,
} from "./garage-runt.helpers";

function parseDateIfValid(val: unknown): Date | null {
  if (typeof val !== "string" || !val.trim()) return null;
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? null : d;
}

function applyProfileFieldsToMotorcycle(
  moto: GarageMotorcycleDocument,
  p: Record<string, unknown>,
): void {
  const str = (v: unknown) =>
    typeof v === "string" && v.trim() ? v.trim() : undefined;
  moto.brand = str(p.marcaMoto) ?? moto.brand;
  moto.modelLine = str(p.lineaMoto) ?? moto.modelLine;
  moto.year = Number(p.anioMoto) || moto.year || new Date().getFullYear();
  moto.displacementCc = Number(p.cilindraje) || moto.displacementCc || 250;
  moto.color = str(p.colorMoto) ?? moto.color;
  moto.motorcycleType = str(p.tipoMoto) ?? moto.motorcycleType;
  moto.vinOrEngineNumber = str(p.vinMoto) ?? moto.vinOrEngineNumber;
  moto.insuranceCompany = str(p.seguroTodoRiesgo) ?? moto.insuranceCompany;
  moto.policyNumber = str(p.polizaNumero) ?? moto.policyNumber;

  const soat = parseDateIfValid(p.soatVigencia);
  if (soat) moto.soatExpiryDate = soat;

  const rtm = parseDateIfValid(p.tecnomecanicaVigencia);
  if (rtm) moto.rtmExpiryDate = rtm;
}

@Injectable()
export class GarageService {
  private readonly logger = new Logger(GarageService.name);
  private readonly runtWindowMs = 10 * 60 * 1000;
  private readonly runtMaxAttempts = 3;
  private readonly runtLocalAttempts = new Map<string, number[]>();

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
    private readonly verifikService: VerifikService,
    private readonly kvCache: KvCacheService,
  ) {}

  private async enforceRuntUserThrottle(userId: string): Promise<void> {
    const now = Date.now();
    const cutoff = now - this.runtWindowMs;
    let timestamps = (this.runtLocalAttempts.get(userId) ?? []).filter(
      (t) => t > cutoff,
    );

    if (this.kvCache?.isAvailable()) {
      try {
        const cached = await this.kvCache.get<number[]>(
          `throttle:runt:${userId}`,
          true,
        );
        if (Array.isArray(cached)) {
          const merged = new Set<number>([
            ...timestamps,
            ...cached.filter((t) => typeof t === "number" && t > cutoff),
          ]);
          timestamps = Array.from(merged);
        }
      } catch {
        // Fallback local
      }
    }

    if (timestamps.length >= this.runtMaxAttempts) {
      this.logger.warn(
        `RUNT verification throttle: user ${userId} exceeded ${this.runtMaxAttempts} attempts in 10 min`,
      );
      throw new HttpException(
        "Has superado el límite de consultas RUNT. Espera 10 minutos e intenta de nuevo.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async recordRuntUserAttempt(userId: string): Promise<void> {
    const now = Date.now();
    const cutoff = now - this.runtWindowMs;
    let timestamps = (this.runtLocalAttempts.get(userId) ?? []).filter(
      (t) => t > cutoff,
    );

    if (this.kvCache?.isAvailable()) {
      try {
        const cached = await this.kvCache.get<number[]>(
          `throttle:runt:${userId}`,
          true,
        );
        if (Array.isArray(cached)) {
          const merged = new Set<number>([
            ...timestamps,
            ...cached.filter((t) => typeof t === "number" && t > cutoff),
          ]);
          timestamps = Array.from(merged).sort((a, b) => a - b);
        }
      } catch {
        // Fallback local
      }
    }

    timestamps.push(now);
    this.runtLocalAttempts.set(userId, timestamps);

    if (this.kvCache?.isAvailable()) {
      try {
        const ttlSec = Math.ceil(this.runtWindowMs / 1000);
        await this.kvCache.set(
          `throttle:runt:${userId}`,
          timestamps,
          ttlSec,
          true,
        );
      } catch {
        // Fallback local
      }
    }
  }

  async getDashboard(userId: string, targetMotorcycleId?: string) {
    return executeGetDashboard(
      {
        motorcycleModel: this.motorcycleModel,
        maintenanceModel: this.maintenanceModel,
        odometerModel: this.odometerModel,
        eventRegistrationModel: this.eventRegistrationModel,
        orderModel: this.orderModel,
      },
      this.usersService,
      userId,
      targetMotorcycleId,
    );
  }

  async createMotorcycle(userId: string, dto: CreateMotorcycleDto) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new NotFoundException("Usuario no encontrado");
    }
    const isLegend = user.membershipLevel === "Legend";
    return executeCreateMotorcycle(
      this.motorcycleModel,
      this.odometerModel,
      userId,
      dto,
      isLegend,
      this.logger,
    );
  }

  async updateMotorcycle(
    userId: string,
    motorcycleId: string,
    dto: UpdateMotorcycleDto,
  ) {
    return executeUpdateMotorcycle(
      this.motorcycleModel,
      this.odometerModel,
      userId,
      motorcycleId,
      dto,
    );
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
    return executeUpdateOdometer(
      this.motorcycleModel,
      this.odometerModel,
      userId,
      motorcycleId,
      dto,
    );
  }

  async createMaintenance(
    userId: string,
    motorcycleId: string,
    dto: CreateMaintenanceDto,
  ) {
    return executeCreateMaintenance(
      this.motorcycleModel,
      this.maintenanceModel,
      userId,
      motorcycleId,
      dto,
    );
  }

  async recordAlliedServiceOrder(dto: AlliedServiceOrderDto) {
    return executeRecordAlliedServiceOrder(
      this.motorcycleModel,
      this.maintenanceModel,
      this.odometerModel,
      dto,
      this.logger,
    );
  }

  getAlliedWorkshops() {
    return ALLIED_WORKSHOPS;
  }

  async verifyMotorcycleWithRunt(
    userId: string,
    motorcycleId: string,
    dto?: VerifyRuntDto,
  ) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new NotFoundException("Usuario no encontrado");
    }

    const moto = await this.motorcycleModel.findOne({
      _id: motorcycleId,
      userId,
    });
    if (!moto) {
      throw new NotFoundException("Motocicleta no encontrada");
    }

    await this.enforceRuntUserThrottle(userId);
    try {
      return await executeVerifyMotorcycleWithRunt(
        this.verifikService,
        user,
        moto,
        dto,
        userId,
        this.logger,
      );
    } finally {
      await this.recordRuntUserAttempt(userId);
    }
  }

  async lookupVehicleByVin(vin: string) {
    const res = await this.verifikService.verifyRuntVehicleByVin(vin);
    if (!res.ok) {
      throw new BadRequestException(res.message);
    }
    return res.record;
  }

  async lookupVehicleByPlate(plate: string) {
    const res = await this.verifikService.verifyRuntVehicleByPlate(plate);
    if (!res.ok) {
      throw new BadRequestException(res.message);
    }
    return res.record;
  }

  async getMotorcycleDiagnostic(userId: string, motorcycleId: string) {
    const user = await this.usersService.findById(userId);
    if (!user) throw new NotFoundException("Usuario no encontrado");

    const moto = await this.motorcycleModel.findOne({
      _id: motorcycleId,
      userId,
    });
    if (!moto) throw new NotFoundException("Motocicleta no encontrada");

    const personal = user.profile?.["datos-personales"] as
      Record<string, unknown> | undefined;
    const docHolder =
      typeof personal?.numeroDocumento === "string"
        ? personal.numeroDocumento
        : undefined;
    const docType =
      typeof personal?.tipoDocumento === "string"
        ? personal.tipoDocumento
        : "CC";

    return this.verifikService.getFullVehicleDiagnostic(
      moto.vinOrEngineNumber || moto.plate,
      docHolder,
      docType,
    );
  }

  async syncMotorcycleWithVerifik(
    userId: string,
    motorcycleId: string,
    dto?: VerifyRuntDto,
  ) {
    const user = await this.usersService.findById(userId);
    if (!user) throw new NotFoundException("Usuario no encontrado");

    const moto = await this.motorcycleModel.findOne({
      _id: motorcycleId,
      userId,
    });
    if (!moto) throw new NotFoundException("Motocicleta no encontrada");

    await this.enforceRuntUserThrottle(userId);
    try {
      return await executeSyncMotorcycleWithVerifik(
        this.verifikService,
        user,
        moto,
        dto,
        userId,
        this.logger,
      );
    } finally {
      await this.recordRuntUserAttempt(userId);
    }
  }

  private async resolveProfileMotorcycle(
    userId: string,
    plate: string,
    isLegend: boolean,
  ): Promise<{ moto: GarageMotorcycleDocument | null; isNew: boolean }> {
    const existing = await this.motorcycleModel.findOne({ userId, plate });
    if (existing) {
      return { moto: existing, isNew: false };
    }

    const count = await this.motorcycleModel.countDocuments({ userId });
    if (!isLegend && count >= 1) {
      const primary = await this.motorcycleModel.findOne({
        userId,
        isPrimary: true,
      });
      return { moto: primary, isNew: false };
    }

    const newMoto = new this.motorcycleModel({
      userId,
      plate,
      isPrimary: count === 0,
    });
    return { moto: newMoto, isNew: true };
  }

  private extractPlateString(val: unknown): string {
    if (typeof val === "string") {
      return val;
    }
    if (typeof val === "number") {
      return `${val}`;
    }
    return "";
  }

  async syncMotorcycleFromProfile(userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user?.profile) return null;

    const motoProfile = user.profile["motocicleta"] as
      Record<string, unknown> | undefined;
    if (!motoProfile?.placaMoto) return null;

    const plate = this.extractPlateString(motoProfile.placaMoto)
      .trim()
      .toUpperCase();
    if (!plate) return null;

    const isLegend = user.membershipLevel === "Legend";
    const { moto, isNew } = await this.resolveProfileMotorcycle(
      userId,
      plate,
      isLegend,
    );
    if (!moto) return null;

    applyProfileFieldsToMotorcycle(moto, motoProfile);
    await moto.save();

    return { success: true, isNew, motorcycle: moto };
  }
}
