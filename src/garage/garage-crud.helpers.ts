import { BadRequestException, Logger, NotFoundException } from "@nestjs/common";
import { Model } from "mongoose";
import type { GarageMotorcycleDocument } from "./schemas/garage-motorcycle.schema";
import {
  type OdometerLogDocument,
  OdometerSource,
} from "./schemas/odometer-log.schema";
import type { CreateMotorcycleDto } from "./dto/create-motorcycle.dto";
import type { UpdateMotorcycleDto } from "./dto/update-motorcycle.dto";
import type { UpdateOdometerDto } from "./dto/update-odometer.dto";
import { parseDateOrNull } from "./garage-calc.helpers";

export function applyBasicSpecsUpdates(
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

export function applyOptionalDetailsUpdates(
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

export function applyDocumentDateUpdates(
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

export async function executeCreateMotorcycle(
  motorcycleModel: Model<GarageMotorcycleDocument>,
  odometerModel: Model<OdometerLogDocument>,
  userId: string,
  dto: CreateMotorcycleDto,
  isLegend: boolean,
  logger: Logger,
) {
  const currentCount = await motorcycleModel.countDocuments({ userId });
  if (!isLegend && currentCount >= 1) {
    throw new BadRequestException(
      "Límite de vehículos alcanzado para cuenta gratuita (1 moto). Actualiza a membresía Legend para garaje extendido.",
    );
  }

  const normalizedPlate = dto.plate.trim().toUpperCase();
  const existing = await motorcycleModel.findOne({
    userId,
    plate: normalizedPlate,
  });
  if (existing) {
    throw new BadRequestException(
      `Ya tienes una motocicleta registrada con la placa ${normalizedPlate}`,
    );
  }

  const newMoto = new motorcycleModel({
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

  await odometerModel.create({
    userId,
    motorcycleId: String(saved._id),
    odometerKm: dto.currentOdometerKm,
    recordedAt: new Date(),
    source: OdometerSource.MANUAL_QUICK,
  });

  logger.log(`Motorcycle created for user ${userId}: ${saved.plate}`);
  return saved;
}

export async function executeUpdateMotorcycle(
  motorcycleModel: Model<GarageMotorcycleDocument>,
  odometerModel: Model<OdometerLogDocument>,
  userId: string,
  motorcycleId: string,
  dto: UpdateMotorcycleDto,
) {
  const moto = await motorcycleModel.findOne({ _id: motorcycleId, userId });
  if (!moto) {
    throw new NotFoundException("Motocicleta no encontrada");
  }

  applyBasicSpecsUpdates(moto, dto);
  applyOptionalDetailsUpdates(moto, dto);
  applyDocumentDateUpdates(moto, dto);

  if (
    dto.currentOdometerKm !== undefined &&
    dto.currentOdometerKm !== moto.currentOdometerKm
  ) {
    moto.currentOdometerKm = dto.currentOdometerKm;
    moto.odometerLastUpdatedAt = new Date();
    await odometerModel.create({
      userId,
      motorcycleId,
      odometerKm: dto.currentOdometerKm,
      recordedAt: new Date(),
      source: OdometerSource.MANUAL_QUICK,
    });
  }

  return moto.save();
}

export async function executeUpdateOdometer(
  motorcycleModel: Model<GarageMotorcycleDocument>,
  odometerModel: Model<OdometerLogDocument>,
  userId: string,
  motorcycleId: string,
  dto: UpdateOdometerDto,
) {
  const moto = await motorcycleModel.findOne({ _id: motorcycleId, userId });
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

  const log = await odometerModel.create({
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
