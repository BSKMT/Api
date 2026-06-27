import { IsEnum, IsOptional, IsString, MaxLength } from "class-validator";
import { ArphaRequestStatus } from "../../arpha/schemas/arpha-request.schema";

export class UpdateArphaStatusDto {
  @IsEnum(ArphaRequestStatus)
  status: ArphaRequestStatus;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  resolution?: string;
}
