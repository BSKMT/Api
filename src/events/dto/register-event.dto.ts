import { IsString, IsIn } from "class-validator";

export class RegisterEventDto {
  @IsString()
  eventSlug: string;

  @IsString()
  @IsIn(["managed", "self-managed"])
  registrationType: string;

  @IsString()
  @IsIn(["solo", "with-companion"])
  attendanceMode: string;
}
