import { Model } from "mongoose";
import { NotFoundException } from "@nestjs/common";
import { TicketDocument } from "../schemas/ticket.schema";
import { TicketQueryDto } from "../dto/ticket-query.dto";
import { buildTicketFilter } from "./ticket-query.helper";
import { evaluateSlaBreach } from "./ticket-sla.helper";

export async function queryTickets(
  ticketModel: Model<TicketDocument>,
  query: TicketQueryDto,
): Promise<{
  tickets: TicketDocument[];
  total: number;
  page: number;
  limit: number;
}> {
  const filter = buildTicketFilter(query);
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const [tickets, total] = await Promise.all([
    ticketModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .exec(),
    ticketModel.countDocuments(filter).exec(),
  ]);

  tickets.forEach((t) => {
    t.sla.isSlaBreached = evaluateSlaBreach(t.sla, t.status);
  });
  return { tickets, total, page, limit };
}

function sanitizeTicketForMember(ticket: TicketDocument): void {
  ticket.messages = ticket.messages.filter((m) => !m.isInternalNote);
  // M-10: Strip internal staff/CRM metadata from member-facing ticket responses.
  ticket.auditLog = [];
  ticket.metadata = {};
  if (ticket.customer) {
    ticket.customer.birdContactId = undefined;
  }
  if (ticket.assignedTo) {
    (ticket.assignedTo as unknown as Record<string, unknown>).email = undefined;
  }
}

export async function findTicketById(
  ticketModel: Model<TicketDocument>,
  ticketId: string,
  isStaffOrAdmin: boolean,
): Promise<TicketDocument> {
  const ticket = await ticketModel.findById(ticketId).exec();
  if (!ticket) throw new NotFoundException("Ticket no encontrado");
  ticket.sla.isSlaBreached = evaluateSlaBreach(ticket.sla, ticket.status);
  if (!isStaffOrAdmin) {
    sanitizeTicketForMember(ticket);
  }
  return ticket;
}

export async function findTicketsForUser(
  ticketModel: Model<TicketDocument>,
  userId: string,
): Promise<TicketDocument[]> {
  const tickets = await ticketModel
    .find({ "customer.userId": userId })
    .sort({ createdAt: -1 })
    .limit(100)
    .exec();
  tickets.forEach((t) => {
    t.sla.isSlaBreached = evaluateSlaBreach(t.sla, t.status);
    sanitizeTicketForMember(t);
  });
  return tickets;
}
