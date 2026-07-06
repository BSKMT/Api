import { IsString, IsNotEmpty, MinLength, MaxLength } from "class-validator";

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword!: string;
}

export class EnableTwoFactorDto {
  @IsString()
  @IsNotEmpty()
  password!: string;
}

export class VerifyTwoFactorDto {
  @IsString()
  @IsNotEmpty()
  code!: string;
}

export class DisableTwoFactorDto {
  @IsString()
  @IsNotEmpty()
  password!: string;
}