import {
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { Model } from "mongoose";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { GarageMotorcycleDocument } from "./schemas/garage-motorcycle.schema";
import {
  MaintenanceLogDocument,
  MaintenanceSource,
} from "./schemas/maintenance-log.schema";
import {
  OdometerLogDocument,
  OdometerSource,
} from "./schemas/odometer-log.schema";
import type { CreateMaintenanceDto } from "./dto/create-maintenance.dto";
import type { AlliedServiceOrderDto } from "./dto/allied-service-order.dto";

export async function executeCreateMaintenance(
  motorcycleModel: Model<GarageMotorcycleDocument>,
  maintenanceModel: Model<MaintenanceLogDocument>,
  userId: string,
  motorcycleId: string,
  dto: CreateMaintenanceDto,
) {
  const moto = await motorcycleModel.findOne({ _id: motorcycleId, userId });
  if (!moto) {
    throw new NotFoundException("Motocicleta no encontrada");
  }

  const log = new maintenanceModel({
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

export async function executeRecordAlliedServiceOrder(
  motorcycleModel: Model<GarageMotorcycleDocument>,
  maintenanceModel: Model<MaintenanceLogDocument>,
  odometerModel: Model<OdometerLogDocument>,
  dto: AlliedServiceOrderDto,
  logger: Logger,
) {
  const envTokens = (process.env.ALLIED_WORKSHOP_TOKENS ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const allowedTokens =
    envTokens.length > 0
      ? envTokens
      : ["BSK-PARTNER-WORKSHOP-2026", "BSK-ALLIED-SECRET"];

  const providedBuf = Buffer.from(dto.workshopAuthToken);
  const isValid = allowedTokens.some((token) => {
    const tokenBuf = Buffer.from(token);
    return (
      providedBuf.length === tokenBuf.length &&
      timingSafeEqual(providedBuf, tokenBuf)
    );
  });

  if (!isValid) {
    throw new UnauthorizedException(
      "Token de autorización de taller aliado inválido",
    );
  }

  const moto = await motorcycleModel.findOne({
    _id: dto.motorcycleId,
    userId: dto.targetUserId,
  });
  if (!moto) {
    throw new NotFoundException("Motocicleta de miembro no encontrada");
  }

  const randomSuffix = randomBytes(3).toString("hex").toUpperCase();
  const verificationCode = `BSK-CERT-${new Date().getFullYear()}-${randomSuffix}`;

  const log = new maintenanceModel({
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
    await odometerModel.create({
      userId: dto.targetUserId,
      motorcycleId: dto.motorcycleId,
      odometerKm: dto.odometerKm,
      recordedAt: new Date(),
      source: OdometerSource.SERVICE_ORDER,
      referenceId: verificationCode,
    });
  }

  logger.log(
    `Allied service order registered: ${verificationCode} for moto ${moto.plate}`,
  );

  return {
    success: true,
    verificationCode,
    log: saved,
  };
}
