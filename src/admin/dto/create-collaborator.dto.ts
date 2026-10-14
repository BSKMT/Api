import {
  IsString,
  IsEmail,
  IsOptional,
  MinLength,
  MaxLength,
  IsEnum,
} from "class-validator";
import { Transform } from "class-transformer";
import { UserSubrole } from "../../users/schemas/user-subdocuments.schema";

export class CreateCollaboratorDto {
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
