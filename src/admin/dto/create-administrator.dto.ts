import {
  IsString,
  IsEmail,
  IsOptional,
  MinLength,
  MaxLength,
  IsArray,
} from "class-validator";
import { Transform } from "class-transformer";

export class CreateAdministratorDto {
  @IsString()
  @IsOptional()
  cedula?: string;

  @IsString()
  @IsOptional()
  primerNombre?: string;

  @IsString()
  @IsOptional()
  segundoNombre?: string;

  @IsString()
  @IsOptional()
  primerApellido?: string;

  @IsString()
  @IsOptional()
  segundoApellido?: string;

  @IsEmail()
  @IsOptional()
  correoInstitucional?: string;

  @IsString()
  @IsOptional()
  telefono?: string;

  @IsString()
  @IsOptional()
  cargo?: string;

  @IsString()
  @IsOptional()
  area?: string;

  @Transform(({ value }: { value: unknown }): string[] | undefined => {
    if (value === undefined || value === null) {
      return undefined;
    }
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === "string");
    }
    if (typeof value === "object") {
      return Object.entries(value)
        .filter(([_, v]) => Boolean(v))
        .map(([k]) => k);
    }
    return undefined;
  })
  @IsArray()
  @IsOptional()
  adminPermissions?: string[];

  @IsString()
  @IsOptional()
  subrol?: string;

  @IsString()
  @IsOptional()
  tipoContrato?: string;

  @IsString()
  @IsOptional()
  firstName?: string;

  @IsString()
  @IsOptional()
  lastName?: string;

  @IsString()
  @IsOptional()
  docType?: string;

  @IsString()
  @IsOptional()
  docNumber?: string;

  @IsEmail()
  @IsOptional()
  institutionalEmail?: string;

  @IsEmail()
  @IsOptional()
  personalEmail?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  birthDate?: string;

  @IsString()
  @IsOptional()
  bloodType?: string;

  @IsString()
  @IsOptional()
  emergencyContactName?: string;

  @IsString()
  @IsOptional()
  emergencyContactPhone?: string;

  @IsString()
  @IsOptional()
  position?: string;

  @IsString()
  @IsOptional()
  department?: string;

  @IsString()
  @IsOptional()
  role?: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}
