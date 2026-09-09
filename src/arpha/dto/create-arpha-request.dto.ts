import {
  IsString,
  IsIn,
  IsOptional,
  MaxLength,
  IsObject,
  ValidateNested,
  IsNumber,
} from "class-validator";
import { Type } from "class-transformer";

export class CoordinatesDto {
  @IsNumber()
  lat!: number;

  @IsNumber()
  lng!: number;
}

export class CreateArphaRequestDto {
  @IsString()
  @IsIn(["tecnica", "emergencia", "juridica", "ruta"])
  requestType!: string;

  @IsString()
  @MaxLength(200)
  location!: string;

  @IsObject()
  @IsOptional()
  @ValidateNested()
  @Type(() => CoordinatesDto)
  coordinates?: CoordinatesDto;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;
}
