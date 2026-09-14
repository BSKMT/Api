import { IsString } from "class-validator";

export class AuthMemberDto {
  @IsString()
  connection_id!: string;
}

export class AuthChannelDto {
  @IsString()
  connection_id!: string;

  @IsString()
  channel_name!: string;
}
