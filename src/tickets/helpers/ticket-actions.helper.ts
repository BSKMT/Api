import { Model } from "mongoose";
import { randomUUID } from "node:crypto";
import {
  TicketDocument,
  TicketStatus,
  TicketPriority,
} from "../schemas/ticket.schema";
import { TicketReplyDto } from "../dto/ticket-reply.dto";

export async function generateTicketNumber(
  ticketModel: Model<TicketDocument>,
): Promise<string> {
  const year = new Date().getFullYear();
  const count = await ticketModel.countDocuments().exec();
  const sequence = String(Number(count) + 1001).padStart(5, "0");
  return `TK-${year}-${sequence}`;
}

export function applyTicketReply(
  ticket: TicketDocument,
  dto: TicketReplyDto,
  actor: { userId: string; name: string; email: string; isAgent: boolean },
): { isInternal: boolean } {
  const isInternal = Boolean(dto.isInternalNote && actor.isAgent);
  const senderType: "agent" | "customer" = actor.isAgent ? "agent" : "customer";
  const newMessage = {
    messageId: randomUUID(),
    sender: senderType,
    senderName: actor.name,
    senderEmail: actor.email,
    content: dto.content,
    isInternalNote: isInternal,
    createdAt: new Date(),
  };

  ticket.messages.push(newMessage);

  if (actor.isAgent && !isInternal) {
    if (!ticket.sla.firstRespondedAt) {
      ticket.sla.firstRespondedAt = new Date();
    }
    if (
      ticket.status === TicketStatus.NUEVO ||
      ticket.status === TicketStatus.ABIERTO
    ) {
      ticket.status = TicketStatus.PENDIENTE;
    }
  } else if (!actor.isAgent) {
    if (
      ticket.status === TicketStatus.PENDIENTE ||
      ticket.status === TicketStatus.RESUELTO
    ) {
      ticket.status = TicketStatus.ABIERTO;
    }
  }

  ticket.auditLog.push({
    action: isInternal ? "internal_note_added" : "reply_sent",
    performedBy: actor.name,
    timestamp: new Date(),
  });

  return { isInternal };
}

export function applyTicketStatus(
  ticket: TicketDocument,
  status: TicketStatus,
  actorName: string,
): void {
  const prev = ticket.status;
  ticket.status = status;
  if (status === TicketStatus.RESUELTO || status === TicketStatus.CERRADO) {
    ticket.sla.resolvedAt = new Date();
  }
  ticket.auditLog.push({
    action: "status_changed",
    performedBy: actorName,
    details: { from: prev, to: status },
    timestamp: new Date(),
  });
}

export function applyTicketPriority(
  ticket: TicketDocument,
  priority: TicketPriority,
  actorName: string,
): void {
  const prev = ticket.priority;
  ticket.priority = priority;
  ticket.auditLog.push({
    action: "priority_changed",
    performedBy: actorName,
    details: { from: prev, to: priority },
    timestamp: new Date(),
  });
}

export function extractUserName(
  user?: {
    name?: string;
    email?: string;
    profile?: Record<string, unknown>;
    contractorInfo?: { nombres?: string; apellidos?: string } | null;
  } | null,
  fallback = "Usuario BSKMT",
): string {
  if (!user) return fallback;
  if (user.name) return user.name;
  const personal = user.profile?.["datos-personales"] as
    Record<string, string> | undefined;
  const personalName = [personal?.primerNombre, personal?.primerApellido]
    .filter(Boolean)
    .join(" ");
  if (personalName) return personalName;
  const contractorName = [
    user.contractorInfo?.nombres,
    user.contractorInfo?.apellidos,
  ]
    .filter(Boolean)
    .join(" ");
  if (contractorName) return contractorName;
  return user.email || fallback;
}
