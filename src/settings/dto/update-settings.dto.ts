import { IsObject, IsOptional } from "class-validator";

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// M-12: Whitelist of allowed keys per top-level settings section
const SETTINGS_KEYS_WHITELIST: Record<string, Set<string>> = {
  notifications: new Set(["channels", "categories"]),
  privacy: new Set([
    "profileVisible",
    "showLocation",
    "allowFriendRequests",
    "shareStats",
    "showMotorcycle",
  ]),
  appearance: new Set(["theme", "density", "language"]),
  dashboard: new Set(["defaultView", "widgets"]),
};

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

  // M-9/M-10: depth-limit and maxKeys to prevent DoS via deeply nested JSON
  private static readonly MAX_DEPTH = 5;
  private static readonly MAX_KEYS = 50;

  static sanitize(
    obj: Record<string, unknown>,
    section?: string,
    depth = 0,
  ): Record<string, unknown> {
    const cleaned: Record<string, unknown> = {};
    if (depth >= this.MAX_DEPTH) return cleaned;
    const allowedKeys = section
      ? (SETTINGS_KEYS_WHITELIST[section] ?? null)
      : null;
    let keyCount = 0;
    for (const [key, value] of Object.entries(obj)) {
      if (++keyCount > this.MAX_KEYS) break;
      if (FORBIDDEN_KEYS.has(key)) continue;
      if (allowedKeys && !allowedKeys.has(key)) continue;
      if (value && typeof value === "object" && !Array.isArray(value)) {
        cleaned[key] = UpdateSettingsDto.sanitize(
          value as Record<string, unknown>,
          undefined,
          depth + 1,
        );
      } else {
        cleaned[key] = value;
      }
    }
    return cleaned;
  }
}
