import { IsNotEmpty, IsString } from "class-validator";

export class DeleteProfileSectionDto {
  @IsString()
  @IsNotEmpty()
  sectionId!: string;
}
