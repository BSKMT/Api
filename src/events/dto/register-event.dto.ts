import { IsString, IsIn, Matches, MaxLength } from "class-validator";

export class RegisterEventDto {
  @IsString()
  @Matches(/^[a-z0-9-]+$/, {
    message: "eventSlug contiene caracteres no válidos",
  })
  @MaxLength(200)
  eventSlug!: string;

  @IsString()
  @IsIn(["managed", "self-managed"])
  registrationType!: string;

  @IsString()
  @IsIn(["solo", "with-companion"])
  attendanceMode!: string;
}
