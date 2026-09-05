import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from "class-validator";
import { OdometerSource } from "../schemas/odometer-log.schema";

export class UpdateOdometerDto {
  @IsInt()
  @IsNotEmpty()
  @Min(0)
  @Max(2000000)
  odometerKm!: number;

  @IsOptional()
  @IsEnum(OdometerSource)
  source?: OdometerSource;

  @IsOptional()
  @IsString()
  referenceId?: string;
}
