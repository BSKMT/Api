import { IsString, IsInt, Min, Max, Matches, MaxLength } from "class-validator";

export class UpdateProgressDto {
  @IsString()
  @Matches(/^[a-z0-9-]+$/, {
    message: "courseSlug contiene caracteres no válidos",
  })
  @MaxLength(200)
  courseSlug!: string;

  @IsInt()
  @Min(0)
  @Max(100)
  progress!: number;
}