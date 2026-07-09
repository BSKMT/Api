import {
  IsString,
  IsEmail,
  IsOptional,
  MinLength,
  MaxLength,
  Matches,
} from "class-validator";

export class SubmitCompanionDto {
  @IsString()
  @Matches(/^[a-z0-9-]+$/, {
    message: "eventSlug contiene caracteres no válidos",
  })
  @MaxLength(200)
  eventSlug!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  fullName!: string;

  @IsString()
  @MinLength(5)
  @MaxLength(20)
  documentId!: string;

  @IsString()
  @MinLength(7)
  @MaxLength(20)
  phone!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  relationship?: string;
}
