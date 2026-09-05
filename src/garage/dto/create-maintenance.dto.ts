import {
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from "class-validator";
import { MaintenanceType } from "../schemas/maintenance-log.schema";

export class CreateMaintenanceDto {
  @IsString()
  @IsNotEmpty()
  date!: string;

  @IsInt()
  @Min(0)
  odometerKm!: number;

  @IsEnum(MaintenanceType)
  maintenanceType!: MaintenanceType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  workshop!: string;

  @IsArray()
  @IsString({ each: true })
  partsChanged!: string[];

  @IsOptional()
  @IsString()
  @MaxLength(80)
  oilType?: string;

  @IsNumber()
  @Min(0)
  cost!: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  invoiceNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
