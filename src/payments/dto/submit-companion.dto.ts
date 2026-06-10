import {
  IsString,
  IsEmail,
  MinLength,
  MaxLength,
} from "class-validator";

export class SubmitCompanionDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  fullName: string;

  @IsString()
  @MinLength(5)
  @MaxLength(20)
  documentId: string;

  @IsString()
  @MinLength(7)
  @MaxLength(20)
  phone: string;

  @IsEmail()
  email: string;
}
