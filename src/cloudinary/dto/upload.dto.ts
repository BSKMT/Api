import {
  IsOptional,
  IsString,
  IsArray,
  Matches,
  MaxLength,
} from "class-validator";

export class UploadImageDto {
  @IsOptional()
  @IsString()
  folder?: string;

  @IsOptional()
  @IsString()
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
  folder?: string;

  @IsOptional()
  @IsArray()
  tags?: string[];
}

export class GenerateSignatureDto {
  @IsOptional()
  paramsToSign?: Record<string, unknown>;
}
