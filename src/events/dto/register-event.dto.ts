import { IsString, IsIn } from "class-validator";

export class RegisterEventDto {
  @IsString()
  @IsIn(["rrf-training-bskmt"])
  eventSlug: string;

  @IsString()
  @IsIn(["professional", "self-managed"])
  registrationType: string;

  @IsString()
  @IsIn(["solo", "with-companion"])
  attendanceMode: string;
}
