import {
  IsString,
  MinLength,
  IsIn,
  IsOptional,
  IsNumber,
  IsEnum,
} from "class-validator";
import { Transform } from "class-transformer";
import { ArphaRequestStatus } from "../../arpha/schemas/arpha-request.schema";

export class AssignArphaDto {
  @IsString()
  @MinLength(1)
  gestorId!: string;

  @IsString()
  @MinLength(1)
  gestorName!: string;

  @IsIn(["campo", "mesa"])
  assignedType!: "campo" | "mesa";

  @IsOptional()
  @IsString()
  eta?: string;
}

export class UpdateGestorLocationDto {
  @IsNumber()
  lat!: number;

  @IsNumber()
  lng!: number;
}

export class UpdateGestionStatusDto {
  @Transform(({ value }: { value: unknown }): ArphaRequestStatus => {
    if (typeof value !== "string") return value as ArphaRequestStatus;
    const v = value.toUpperCase().trim();
    if (v === "RESUELTO" || v === "RESOLVED")
      return ArphaRequestStatus.COMPLETED;
    if (v === "CANCELADO") return ArphaRequestStatus.CANCELLED;
    if (v === "EN_SITIO" || v === "ENSITIO") return ArphaRequestStatus.EN_SITIO;
    if (v === "EN_CAMINO" || v === "ENCAMINO")
      return ArphaRequestStatus.EN_CAMINO;
    return v as ArphaRequestStatus;
  })
  @IsEnum(ArphaRequestStatus)
  status!: ArphaRequestStatus;

  @IsOptional()
  @IsString()
  resolution?: string;
}
