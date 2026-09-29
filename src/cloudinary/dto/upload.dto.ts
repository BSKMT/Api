import { IsOptional, IsString, IsArray } from "class-validator";

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
  paramsToSign?: Record<string, any>;
}
