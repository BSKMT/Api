import { IsString, IsOptional, MaxLength } from "class-validator";

export class SendFriendRequestDto {
  @IsString()
  targetMemberNumber!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
}
