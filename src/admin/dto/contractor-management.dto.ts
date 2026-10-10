import {
  IsString,
  IsNotEmpty,
  IsEmail,
  IsOptional,
  MinLength,
  MaxLength,
  IsEnum,
  IsArray,
} from "class-validator";
import { UserSubrole } from "../../users/schemas/user.schema";

export class CreateCollaboratorDto {
  @IsString()
  @IsNotEmpty()
  cedula!: string;

  @IsString()
  @IsNotEmpty()
  primerNombre!: string;

  @IsString()
  @IsOptional()
  segundoNombre?: string;

  @IsString()
  @IsNotEmpty()
  primerApellido!: string;

  @IsString()
  @IsOptional()
  segundoApellido?: string;

  @IsEmail()
  @IsNotEmpty()
  correoInstitucional!: string;

  @IsString()
  @IsNotEmpty()
  telefono!: string;

  @IsString()
  @IsNotEmpty()
  cargo!: string;

  @IsString()
  @IsOptional()
  area?: string;

  @IsEnum(UserSubrole)
  @IsNotEmpty()
  subrol!: UserSubrole;

  @IsString()
  @IsOptional()
  tipoContrato?: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}

export class CreateAdministratorDto {
  @IsString()
  @IsNotEmpty()
  cedula!: string;

  @IsString()
  @IsNotEmpty()
  primerNombre!: string;

  @IsString()
  @IsOptional()
  segundoNombre?: string;

  @IsString()
  @IsNotEmpty()
  primerApellido!: string;

  @IsString()
  @IsOptional()
  segundoApellido?: string;

  @IsEmail()
  @IsNotEmpty()
  correoInstitucional!: string;

  @IsString()
  @IsNotEmpty()
  telefono!: string;

  @IsString()
  @IsNotEmpty()
  cargo!: string;

  @IsString()
  @IsNotEmpty()
  area!: string;

  @IsArray()
  @IsOptional()
  adminPermissions?: string[];

  @IsString()
  @IsOptional()
  subrol?: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}

export class CreateSuperAdminDto {
  @IsString()
  @IsNotEmpty()
  cedula!: string;

  @IsString()
  @IsNotEmpty()
  primerNombre!: string;

  @IsString()
  @IsOptional()
  segundoNombre?: string;

  @IsString()
  @IsNotEmpty()
  primerApellido!: string;

  @IsString()
  @IsOptional()
  segundoApellido?: string;

  @IsEmail()
  @IsNotEmpty()
  correoInstitucional!: string;

  @IsString()
  @IsNotEmpty()
  telefono!: string;

  @IsString()
  @IsNotEmpty()
  cargo!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}
