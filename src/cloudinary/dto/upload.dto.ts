import {
  ArrayMaxSize,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsArray,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { Type } from "class-transformer";

export class UploadImageDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  folder?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  tags?: string;
}

export class UploadBase64Dto {
  @IsString()
  @MaxLength(15 * 1024 * 1024, {
    message: "El archivo base64 excede el tamaño máximo permitido.",
  })
  @Matches(
    /^data:(image\/(jpeg|png|webp|gif)|application\/pdf);base64,[A-Za-z0-9+/=]+$/,
    {
      message:
        "El archivo debe ser un Data URI base64 válido (JPEG, PNG, WebP, GIF o PDF). No se permiten URLs externas.",
    },
  )
  image!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  folder?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  tags?: string[];
}

export class GenerateSignatureDto {
  @IsOptional()
  paramsToSign?: Record<string, unknown>;
}

export class OptimizeUrlQueryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  url!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(16)
  @Max(4096)
  width?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(16)
  @Max(4096)
  height?: number;

  @IsOptional()
  @IsString()
  @IsIn(["fill", "fit", "limit", "scale", "thumb", "crop", "pad"])
  crop?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(auto|auto:(best|good|eco|low)|[1-9]\d?|100)$/)
  quality?: string;

  @IsOptional()
  @IsString()
  @IsIn(["auto", "webp", "avif", "jpg", "jpeg", "png"])
  format?: string;
}
