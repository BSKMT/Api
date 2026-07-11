import { IsString, IsNotEmpty, IsEmail, MaxLength } from "class-validator";

export class LoginOtpInitiateDto {
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password!: string;

  @IsString()
  @MaxLength(10)
  rememberMe?: string;
}

export class LoginOtpVerifyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  requestId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(6)
  code!: string;
}
