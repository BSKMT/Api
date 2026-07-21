import { IsNotEmpty, IsString, MaxLength } from "class-validator";

const VALID_DELETE_SECTION_IDS = [
  "datos-personales",
  "contacto",
  "motocicleta",
  "salud-seguridad",
  "documentacion-legal",
  "equipamiento",
  "experiencia-motera",
  "membresia-ecosistema",
] as const;

export class DeleteProfileSectionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  sectionId!: string;

  static isValidSectionId(sectionId: string): boolean {
    return (VALID_DELETE_SECTION_IDS as readonly string[]).includes(sectionId);
  }
}
