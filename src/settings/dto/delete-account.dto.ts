import {
  IsString,
  IsOptional,
  IsBoolean,
  MaxLength,
  Equals,
} from "class-validator";

export class DeleteAccountDto {
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  reason?: string;

  @IsBoolean()
  @Equals(true, { message: "Debes confirmar la eliminación de tu cuenta" })
  confirm!: boolean;
}
