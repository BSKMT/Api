import {
  IsString,
  IsNotEmpty,
  MinLength,
  MaxLength,
  IsBoolean,
  IsOptional,
} from "class-validator";

export class TicketReplyDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(5000)
  content!: string;

  @IsBoolean()
  @IsOptional()
  isInternalNote?: boolean = false;

  @IsBoolean()
  @IsOptional()
  sendSms?: boolean;

  @IsBoolean()
  @IsOptional()
  sendWhatsapp?: boolean;
}
