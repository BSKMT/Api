import { IsNotEmpty, IsString, Matches, MaxLength } from "class-validator";

/**
 * Bird Realtime connection IDs are URL-safe opaque identifiers without colons.
 * Rejecting `:` prevents HMAC signing-string delimiter injection (CWE-347).
 */
export const BIRD_CONNECTION_ID_REGEX = /^[A-Za-z0-9._-]{1,64}$/;
export const BIRD_CHANNEL_NAME_REGEX =
  /^(private|presence)-[A-Za-z0-9_=@,.;-]{1,180}$/;

export class AuthMemberDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @Matches(BIRD_CONNECTION_ID_REGEX, {
    message: "connection_id contiene caracteres no permitidos",
  })
  connection_id!: string;
}

export class AuthChannelDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @Matches(BIRD_CONNECTION_ID_REGEX, {
    message: "connection_id contiene caracteres no permitidos",
  })
  connection_id!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(192)
  @Matches(BIRD_CHANNEL_NAME_REGEX, {
    message: "channel_name tiene un formato no autorizado",
  })
  channel_name!: string;
}
