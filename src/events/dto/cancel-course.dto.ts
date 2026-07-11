import { IsString, Matches, MaxLength } from "class-validator";

export class CancelCourseDto {
  @IsString()
  @Matches(/^[a-z0-9-]+$/, {
    message: "courseSlug contiene caracteres no válidos",
  })
  @MaxLength(200)
  courseSlug!: string;
}
