import { IsNotEmpty, IsObject, IsString, MaxLength } from "class-validator";

const VALID_SECTION_IDS = [
  "datos-personales",
  "contacto",
  "motocicleta",
  "salud-seguridad",
  "documentacion-legal",
  "equipamiento",
  "experiencia-motera",
  "membresia-ecosistema",
] as const;

// A-12: numeroMiembro is auto-generated server-side, never user-settable
const FORBIDDEN_BY_SECTION: Record<string, Set<string>> = {
  "membresia-ecosistema": new Set(["numeroMiembro"]),
};

export class UpdateProfileSectionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  sectionId!: string;

  @IsObject()
  data!: Record<string, unknown>;

  static isValidSectionId(sectionId: string): boolean {
    return (VALID_SECTION_IDS as readonly string[]).includes(sectionId);
  }

  // M-10: added maxDepth and maxKeys to prevent DoS via deeply nested JSON
  private static readonly MAX_DEPTH = 5;
  private static readonly MAX_KEYS = 50;

  static sanitize(
    obj: Record<string, unknown>,
    sectionId?: string,
    depth = 0,
  ): Record<string, unknown> {
    const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
    const extraForbidden = sectionId
      ? (FORBIDDEN_BY_SECTION[sectionId] ?? new Set<string>())
      : new Set<string>();
    const cleaned: Record<string, unknown> = {};
    if (depth >= this.MAX_DEPTH) return cleaned;
    let keyCount = 0;
    for (const [key, value] of Object.entries(obj)) {
      if (++keyCount > this.MAX_KEYS) break;
      if (FORBIDDEN_KEYS.has(key) || extraForbidden.has(key)) continue;
      if (value && typeof value === "object" && !Array.isArray(value)) {
        cleaned[key] = UpdateProfileSectionDto.sanitize(
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
