import { IsString, IsNotEmpty, MinLength, MaxLength, Matches } from "class-validator";

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword!: string;
}

export class EnableTwoFactorDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password!: string;
}

export class VerifyTwoFactorDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{6}$/, { message: "El código debe ser de 6 dígitos" })
  code!: string;
}

export class DisableTwoFactorDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password!: string;
}
