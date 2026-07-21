import {
  IsString,
  IsEmail,
  MinLength,
  MaxLength,
  Matches,
} from "class-validator";

export class SubmitCompanionDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Matches(/^[\p{L}\p{M}\s.'-]+$/u, {
    message: "fullName contiene caracteres no válidos",
  })
  fullName!: string;

  @IsString()
  @MinLength(5)
  @MaxLength(20)
  @Matches(/^[a-zA-Z0-9-]+$/, {
    message: "documentId contiene caracteres no válidos",
  })
  documentId!: string;

  @IsString()
  @MinLength(7)
  @MaxLength(20)
  @Matches(/^[0-9+\-\s()]+$/, {
    message: "phone contiene caracteres no válidos",
  })
  phone!: string;

  @IsEmail()
  @MaxLength(200)
  email!: string;
}
