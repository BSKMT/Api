import { IsObject, IsOptional } from "class-validator";

const FORBIDDEN_KEYS = ["__proto__", "constructor", "prototype"];

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

  static sanitize(obj: Record<string, unknown>): Record<string, unknown> {
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (FORBIDDEN_KEYS.includes(key)) continue;
      if (value && typeof value === "object" && !Array.isArray(value)) {
        cleaned[key] = UpdateSettingsDto.sanitize(
          value as Record<string, unknown>,
        );
      } else {
        cleaned[key] = value;
      }
    }
    return cleaned;
  }
}
