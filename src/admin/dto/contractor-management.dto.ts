import {
  IsString,
  IsEmail,
  IsOptional,
  MinLength,
  MaxLength,
  IsEnum,
  IsArray,
} from "class-validator";
import { Transform } from "class-transformer";
import { UserSubrole } from "../../users/schemas/user-subdocuments.schema";

export class CreateCollaboratorDto {
  // Canonical Spanish fields
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

  @Transform(
    ({ value, obj }: { value: unknown; obj?: Record<string, unknown> }) => {
      const raw = value || obj?.role;
      if (typeof raw === "string") {
        const clean = raw.trim();
        if (Object.values(UserSubrole).includes(clean as UserSubrole)) {
          return clean as UserSubrole;
        }
      }
      return UserSubrole.GESTOR_CAMPO;
    },
  )
  @IsEnum(UserSubrole)
  @IsOptional()
  subrol?: UserSubrole;

  @IsString()
  @IsOptional()
  tipoContrato?: string;

  // English / Extended aliases
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

export class CreateAdministratorDto {
  // Canonical Spanish fields
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

  // English / Extended aliases
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

export class CreateSuperAdminDto {
  // Canonical Spanish fields
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

  @IsString()
  @IsOptional()
  tipoContrato?: string;

  @IsString()
  @IsOptional()
  subrol?: string;

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

  // English / Extended aliases
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
