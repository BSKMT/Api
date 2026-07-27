import {
  IsString,
  IsNotEmpty,
  IsEmail,
  IsBoolean,
  IsOptional,
  MaxLength,
} from "class-validator";

export class LoginOtpInitiateDto {
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password!: string;

  @IsBoolean()
  @IsOptional()
  rememberMe?: boolean;
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
