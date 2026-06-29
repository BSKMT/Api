import { IsBoolean, Equals, IsString } from "class-validator";

export class AcceptWaiverDto {
  @IsString()
  eventSlug: string;

  @IsBoolean()
  @Equals(true, {
    message: "Debes aceptar la exoneración de responsabilidad",
  })
  waiverAccepted: boolean;
}
