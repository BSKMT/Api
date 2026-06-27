import { IsString, IsOptional, MaxLength } from "class-validator";

export class AssignArphaRequestDto {
  @IsString()
  @IsOptional()
  @MaxLength(120)
  assignedTechnician?: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  eta?: string;
}
