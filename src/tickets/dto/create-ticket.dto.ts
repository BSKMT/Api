import {
  IsString,
  IsNotEmpty,
  MinLength,
  MaxLength,
  IsEnum,
  IsOptional,
  IsEmail,
  IsArray,
} from "class-validator";
import {
  TicketCategory,
  TicketPriority,
  TicketChannel,
} from "../schemas/ticket.schema";

export class CreateTicketDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(200)
  subject!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(5000)
  description!: string;

  @IsEnum(TicketCategory)
  @IsOptional()
  category?: TicketCategory = TicketCategory.GENERAL;

  @IsEnum(TicketPriority)
  @IsOptional()
  priority?: TicketPriority = TicketPriority.MEDIA;

  @IsEnum(TicketChannel)
  @IsOptional()
  channel?: TicketChannel = TicketChannel.WEB_CONTACT;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  customerName?: string;

  @IsEmail()
  @IsOptional()
  customerEmail?: string;

  @IsString()
  @IsOptional()
  @MaxLength(30)
  customerPhone?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];
}
