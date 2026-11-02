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
import {
  normalizeRuntDocumentType,
  normalizeRuntDocumentNumber,
} from "../verifik/verifik-runt.helpers";
import { isSectionValid } from "../users/users-profile.helper";
import { REQUIRED_PROFILE_SECTIONS } from "../users/schemas/user.schema";
import type {
  VerifikRuntLookupResult,
  VerifikRuntVehicleRecord,
} from "../verifik/verifik.interfaces";

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
  moto.insuranceCompany = str(p.seguroTodoRiesgo) ?? moto.insuranceCompany;
  moto.policyNumber = str(p.polizaNumero) ?? moto.policyNumber;

  const rawDocType =
    str(p.tipoDocumentoPropietario) ??
    str(p.runtDocumentType) ??
    moto.runtDocumentType;
  const docType = normalizeRuntDocumentType(rawDocType);
  const rawHolder =
    str(p.documentoPropietario) ??
    str(p.runtDocumentHolder) ??
    moto.runtDocumentHolder;

  if (rawHolder) {
    moto.runtDocumentHolder = normalizeRuntDocumentNumber(docType, rawHolder);
  }
  moto.runtDocumentType = docType;

  const soat = parseDateIfValid(p.soatVigencia);
  if (soat) moto.soatExpiryDate = soat;

  const rtm = parseDateIfValid(p.tecnomecanicaVigencia);
  if (rtm) moto.rtmExpiryDate = rtm;
}

function buildVerifiedMotoProfile(
  existingMoto: Record<string, unknown>,
  record: VerifikRuntVehicleRecord,
  cleanDocNumber: string,
  cleanDocType: string,
): Record<string, unknown> {
  const motoProfile: Record<string, unknown> = {
    ...existingMoto,
    placaMoto: record.plate,
    marcaMoto: record.brand ?? existingMoto.marcaMoto ?? "",
    lineaMoto: record.modelLine ?? existingMoto.lineaMoto ?? "",
    anioMoto: record.year ? String(record.year) : (existingMoto.anioMoto ?? ""),
    cilindraje: record.displacementCc
      ? String(record.displacementCc)
      : (existingMoto.cilindraje ?? ""),
    colorMoto: record.color ?? existingMoto.colorMoto ?? "",
    tipoMoto:
      record.classType ||
      record.serviceType ||
      existingMoto.tipoMoto ||
      "Naked",
    documentoPropietario:
      cleanDocNumber || existingMoto.documentoPropietario || "",
    tipoDocumentoPropietario:
      cleanDocType || existingMoto.tipoDocumentoPropietario || "CC",
    verificadaRunt: "true",
    verificadaAt: new Date().toISOString(),
    estadoRunt: "ACTIVO",
  };

  if (record.soat?.expiryDate) {
    motoProfile.soatVigencia = String(record.soat.expiryDate).slice(0, 10);
  }
  if (record.rtm?.expiryDate) {
    motoProfile.tecnomecanicaVigencia = String(record.rtm.expiryDate).slice(
      0,
      10,
    );
  }
  return motoProfile;
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

  async lookupVehicleByPlate(
    plate: string,
    documentNumber?: string,
    documentType?: string,
  ) {
    const cleanPlate = plate.trim().toUpperCase();
    const cleanType = normalizeRuntDocumentType(documentType);
    const cleanDoc = normalizeRuntDocumentNumber(cleanType, documentNumber);

    if (cleanDoc) {
      const docResult = await this.verifikService.verifyRuntVehicle(
        cleanType,
        cleanDoc,
        cleanPlate,
      );
      if (docResult.ok) {
        return docResult.record;
      }
      this.logger.warn(
        `RUNT query with plate ${cleanPlate} and document ${cleanDoc} (${cleanType}) did not return record: ${docResult.message}. Falling back to plate-only query.`,
      );
    }

    const res = await this.verifikService.verifyRuntVehicleByPlate(cleanPlate);
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
      moto.runtDocumentHolder ||
      user.identityVerification?.documentNumber ||
      (typeof personal?.numeroDocumento === "string"
        ? personal.numeroDocumento
        : undefined);
    const docType =
      moto.runtDocumentType ||
      user.identityVerification?.documentType ||
      (typeof personal?.tipoDocumento === "string"
        ? personal.tipoDocumento
        : "CC");

    return this.verifikService.getFullVehicleDiagnostic(
      {
        plate: moto.plate,
        fallbackRecord: {
          plate: moto.plate,
          brand: moto.brand,
          modelLine: moto.modelLine,
          year: moto.year,
          displacementCc: moto.displacementCc,
          color: moto.color,
          vinOrChassis: moto.vinOrEngineNumber ?? undefined,
        },
      },
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

  private async resolveRuntLookup(
    userId: string,
    cleanPlate: string,
    cleanDocNumber: string,
    cleanDocType: string,
  ): Promise<VerifikRuntLookupResult> {
    await this.enforceRuntUserThrottle(userId);
    try {
      if (cleanDocNumber) {
        const docResult = await this.verifikService.verifyRuntVehicle(
          cleanDocType,
          cleanDocNumber,
          cleanPlate,
        );
        if (docResult.ok) {
          return docResult;
        }
        this.logger.warn(
          `RUNT query with plate ${cleanPlate} and document ${cleanDocNumber} (${cleanDocType}) did not return vehicle: ${docResult.message}. Falling back to plate-only query.`,
        );
      }
      return await this.verifikService.verifyRuntVehicleByPlate(cleanPlate);
    } finally {
      await this.recordRuntUserAttempt(userId);
    }
  }

  private async syncPrimaryMotorcycle(
    userId: string,
    record: VerifikRuntVehicleRecord,
    motoProfile: Record<string, unknown>,
    cleanDocNumber: string,
    cleanDocType: string,
  ): Promise<GarageMotorcycleDocument> {
    await this.motorcycleModel.updateMany(
      { userId, plate: { $ne: record.plate }, isPrimary: true },
      { $set: { isPrimary: false } },
    );

    let moto = await this.motorcycleModel.findOne({
      userId,
      plate: record.plate,
    });
    if (!moto) {
      moto = new this.motorcycleModel({
        userId,
        plate: record.plate,
        isPrimary: true,
      });
    } else {
      moto.isPrimary = true;
    }

    applyProfileFieldsToMotorcycle(moto, motoProfile);
    moto.isRuntVerified = true;
    moto.runtVerifiedAt = new Date();
    if (record.soat?.status) {
      moto.runtSoatStatus = record.soat.status;
    }
    if (record.rtm?.status) {
      moto.runtRtmStatus = record.rtm.status;
    }
    if (cleanDocNumber) {
      moto.runtDocumentHolder = cleanDocNumber;
    }
    if (cleanDocType) {
      moto.runtDocumentType = cleanDocType;
    }
    if (record.rtm?.cdaName) {
      moto.runtCdaName = record.rtm.cdaName;
    }
    await moto.save();
    return moto;
  }

  async verifyAndSyncProfileMotorcycle(
    userId: string,
    dto: { plate: string; documentNumber?: string; documentType?: string },
  ) {
    const cleanPlate = (dto.plate || "").trim().toUpperCase();
    if (!cleanPlate) {
      throw new BadRequestException("La placa de la motocicleta es requerida.");
    }

    const cleanDocType = normalizeRuntDocumentType(dto.documentType);
    const cleanDocNumber = normalizeRuntDocumentNumber(
      cleanDocType,
      dto.documentNumber,
    );

    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new NotFoundException("Usuario no encontrado.");
    }

    const vehicleResult = await this.resolveRuntLookup(
      userId,
      cleanPlate,
      cleanDocNumber,
      cleanDocType,
    );

    if (!vehicleResult.ok) {
      throw new BadRequestException(
        vehicleResult.message ||
          "No se encontraron registros de la motocicleta en el RUNT oficial.",
      );
    }

    const record = vehicleResult.record;
    const profile = user.profile ?? {};
    const existingMoto =
      (profile["motocicleta"] as Record<string, unknown> | undefined) ?? {};

    const motoProfile = buildVerifiedMotoProfile(
      existingMoto,
      record,
      cleanDocNumber,
      cleanDocType,
    );

    profile["motocicleta"] = motoProfile;
    user.profile = profile;

    const isComplete = isSectionValid(
      "motocicleta",
      motoProfile,
      Boolean(user.identityVerified),
    );
    const completedSections = [...(user.completedSections ?? [])];
    if (isComplete && !completedSections.includes("motocicleta")) {
      completedSections.push("motocicleta");
    }
    user.completedSections = completedSections;
    user.profileCompleted =
      REQUIRED_PROFILE_SECTIONS.every((s) => completedSections.includes(s)) &&
      Boolean(user.identityVerified);

    user.markModified("profile");
    await user.save();

    const moto = await this.syncPrimaryMotorcycle(
      userId,
      record,
      motoProfile,
      cleanDocNumber,
      cleanDocType,
    );

    return {
      ok: true,
      message: `¡Motocicleta verificada y sincronizada exitosamente con RUNT! ${record.brand ?? ""} ${record.modelLine ?? ""} (Placa: ${record.plate}). Registrada como tu motocicleta principal en el Garaje.`,
      profile: user.profile,
      completedSections: user.completedSections,
      profileCompleted: user.profileCompleted,
      motorcycle: moto,
    };
  }
}
