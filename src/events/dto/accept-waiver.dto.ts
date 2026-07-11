import {
  IsBoolean,
  Equals,
  IsString,
  Matches,
  MaxLength,
} from "class-validator";

export class AcceptWaiverDto {
  @IsString()
  @Matches(/^[a-z0-9-]+$/, {
    message: "eventSlug contiene caracteres no válidos",
  })
  @MaxLength(200)
  eventSlug!: string;

  @IsBoolean()
  @Equals(true, {
    message: "Debes aceptar la exoneración de responsabilidad",
  })
  waiverAccepted!: boolean;
}
