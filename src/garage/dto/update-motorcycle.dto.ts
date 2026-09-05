import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { UsageProfile } from "../schemas/garage-motorcycle.schema";

export class UpdateMotorcycleDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  brand?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  modelLine?: string;

  @IsOptional()
  @IsInt()
  @Min(1970)
  @Max(2035)
  year?: number;

  @IsOptional()
  @IsInt()
  @Min(49)
  @Max(3000)
  displacementCc?: number;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  @Matches(/^[A-Z0-9\s-]+$/i, {
    message: "La placa solo debe contener letras, números o guión",
  })
  plate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  vinOrEngineNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  nickname?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  color?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  motorcycleType?: string;

  @IsOptional()
  @IsEnum(UsageProfile)
  usageProfile?: UsageProfile;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2000000)
  currentOdometerKm?: number;

  @IsOptional()
  @IsString()
  soatExpiryDate?: string;

  @IsOptional()
  @IsString()
  rtmExpiryDate?: string;

  @IsOptional()
  @IsString()
  licenseExpiryDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  insuranceCompany?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  policyNumber?: string;
}
