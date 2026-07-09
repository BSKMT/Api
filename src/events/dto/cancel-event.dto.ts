import { IsString, Matches, MaxLength } from "class-validator";

export class CancelEventDto {
  @IsString()
  @Matches(/^[a-z0-9-]+$/, {
    message: "eventSlug contiene caracteres no válidos",
  })
  @MaxLength(200)
  eventSlug!: string;
}