import { IsNotEmpty, IsObject, IsString } from "class-validator";

const VALID_SECTION_IDS = [
  "datos-personales",
  "membresia-ecosistema",
  "motocicleta",
  "seguro-motocicleta",
  "licencia-motocicleta",
  "preferencias",
] as const;

export class UpdateProfileSectionDto {
  @IsString()
  @IsNotEmpty()
  sectionId!: string;

  @IsObject()
  data!: Record<string, unknown>;

  static isValidSectionId(sectionId: string): boolean {
    return (VALID_SECTION_IDS as readonly string[]).includes(sectionId);
  }

  static sanitize(obj: Record<string, unknown>): Record<string, unknown> {
    const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (FORBIDDEN_KEYS.has(key)) continue;
      if (value && typeof value === "object" && !Array.isArray(value)) {
        cleaned[key] = UpdateProfileSectionDto.sanitize(
          value as Record<string, unknown>,
        );
      } else {
        cleaned[key] = value;
      }
    }
    return cleaned;
  }
}
