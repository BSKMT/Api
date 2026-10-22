import { IsEnum, IsString, IsArray } from "class-validator";
import { TicketStatus, TicketPriority } from "../schemas/ticket.schema";

export class UpdateTicketStatusDto {
  @IsEnum(TicketStatus)
  status!: TicketStatus;
}

export class UpdateTicketPriorityDto {
  @IsEnum(TicketPriority)
  priority!: TicketPriority;
}

export class AssignTicketDto {
  @IsString()
  assignedToUserId!: string;
}

export class UpdateTicketTagsDto {
  @IsArray()
  @IsString({ each: true })
  tags!: string[];
}
