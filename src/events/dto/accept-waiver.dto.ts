import { IsBoolean, Equals } from "class-validator";

export class AcceptWaiverDto {
  @IsBoolean()
  @Equals(true, {
    message: "Debes aceptar la exoneración de responsabilidad",
  })
  waiverAccepted: boolean;
}
