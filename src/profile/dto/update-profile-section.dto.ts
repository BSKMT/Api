import { IsNotEmpty, IsObject, IsString } from "class-validator";

export class UpdateProfileSectionDto {
  @IsString()
  @IsNotEmpty()
  sectionId!: string;

  @IsObject()
  data!: Record<string, unknown>;
}
