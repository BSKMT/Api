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
  private static readonly MAX_ARRAY_ITEMS = 50;
  private static readonly MAX_STRING_LEN = 500;

  private static sanitizeValue(value: unknown, depth: number): unknown {
    if (Array.isArray(value)) {
      return value
        .slice(0, UpdateSettingsDto.MAX_ARRAY_ITEMS)
        .map((item) => UpdateSettingsDto.sanitizeValue(item, depth + 1));
    }
    if (value && typeof value === "object") {
      return UpdateSettingsDto.sanitize(
        value as Record<string, unknown>,
        undefined,
        depth + 1,
      );
    }
    if (typeof value === "string") {
      return value.slice(0, UpdateSettingsDto.MAX_STRING_LEN);
    }
    return value;
  }

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
      // L-08: Reject MongoDB operator keys ($) and dot-notation keys (.) at every level.
      if (FORBIDDEN_KEYS.has(key) || key.startsWith("$") || key.includes(".")) {
        continue;
      }
      if (allowedKeys && !allowedKeys.has(key)) continue;
      cleaned[key] = UpdateSettingsDto.sanitizeValue(value, depth);
    }
    return cleaned;
  }
}
