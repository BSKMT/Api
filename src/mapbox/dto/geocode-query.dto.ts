import { IsNumber, IsString, MinLength, MaxLength, Min, Max } from "class-validator";
import { Type, Transform } from "class-transformer";

export class ReverseGeocodeQueryDto {
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng!: number;
}

export class ForwardGeocodeQueryDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  q!: string;
}

export class DirectionsQueryDto {
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  originLng!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  originLat!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  destLng!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  destLat!: number;
}
