import { IsObject, IsOptional, IsString, IsBoolean } from "class-validator";

export class UpdateSettingsDto {
  @IsOptional()
  @IsObject()
  notifications?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  privacy?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  appearance?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  dashboard?: Record<string, unknown>;
}