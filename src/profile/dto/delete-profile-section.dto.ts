import { IsString, IsNotEmpty } from 'class-validator';

export class DeleteProfileSectionDto {
  @IsString()
  @IsNotEmpty()
  sectionId: string;
}
