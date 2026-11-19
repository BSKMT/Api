import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";
import { TicketCategory } from "../schemas/ticket.schema";

/**
 * Restricted ticket creation DTO for authenticated members via `/api/panel/support`.
 * Prevents mass assignment of `priority`, `channel`, `customerPhone`, `customerEmail`,
 * `customerName`, or internal `tags`.
 */
export class CreateMemberTicketDto {
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
}
