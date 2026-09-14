import { IsEnum, IsOptional, IsString, MaxLength } from "class-validator";
import { Transform } from "class-transformer";
import { ArphaRequestStatus } from "../../arpha/schemas/arpha-request.schema";

export class UpdateArphaStatusDto {
  @Transform(({ value }) => {
    if (typeof value !== "string") return value;
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

  @IsString()
  @IsOptional()
  @MaxLength(500)
  resolution?: string;
}
