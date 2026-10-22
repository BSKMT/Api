import {
  TicketStatus,
  TicketPriority,
  TicketCategory,
  TicketChannel,
} from "../schemas/ticket.schema";
import { TicketQueryDto } from "../dto/ticket-query.dto";

export function escapeRegex(text: string): string {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, String.raw`\$&`);
}

export function buildTicketFilter(
  query: TicketQueryDto,
): Record<string, unknown> {
  const filter: Record<string, unknown> = {};

  if (
    query.status &&
    Object.values(TicketStatus).includes(query.status as TicketStatus)
  ) {
    filter.status = query.status;
  }
  if (
    query.priority &&
    Object.values(TicketPriority).includes(query.priority as TicketPriority)
  ) {
    filter.priority = query.priority;
  }
  if (
    query.category &&
    Object.values(TicketCategory).includes(query.category as TicketCategory)
  ) {
    filter.category = query.category;
  }
  if (
    query.channel &&
    Object.values(TicketChannel).includes(query.channel as TicketChannel)
  ) {
    filter.channel = query.channel;
  }
  if (query.assignedTo) {
    filter["assignedTo.userId"] = query.assignedTo;
  }

  if (query.search && query.search.trim().length > 0) {
    const cleanSearch = escapeRegex(query.search.trim().slice(0, 100));
    const searchRegex = new RegExp(cleanSearch, "i");
    filter.$or = [
      { ticketNumber: searchRegex },
      { subject: searchRegex },
      { "customer.name": searchRegex },
      { "customer.email": searchRegex },
      { tags: searchRegex },
    ];
  }

  return filter;
}
