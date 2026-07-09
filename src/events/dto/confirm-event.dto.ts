import { IsString, Matches, MaxLength } from "class-validator";

export class ConfirmEventDto {
  @IsString()
  @Matches(/^[a-z0-9-]+$/, {
    message: "eventSlug contiene caracteres no válidos",
  })
  @MaxLength(200)
  eventSlug!: string;
}