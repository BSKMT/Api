import { IsString, IsIn, IsOptional, MaxLength } from "class-validator";

export class CreateArphaRequestDto {
  @IsString()
  @IsIn(["tecnica", "emergencia", "juridica", "ruta"])
  requestType: string;

  @IsString()
  @MaxLength(200)
  location: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;
}
