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
  let nextSeq = 1001;

  if (typeof ticketModel.findOne === "function") {
    try {
      const query = ticketModel
        .findOne({ ticketNumber: new RegExp(`^TK-${year}-`) })
        .sort({ createdAt: -1, _id: -1 })
        .select("ticketNumber");
      const lastTicket = (
        typeof query?.lean === "function" ? await query.lean() : await query
      ) as { ticketNumber?: string } | null;

      if (lastTicket?.ticketNumber) {
        const parts = lastTicket.ticketNumber.split("-");
        const parsed = Number.parseInt(parts[2], 10);
        if (!Number.isNaN(parsed)) {
          nextSeq = parsed + 1;
          const sequence = String(nextSeq).padStart(5, "0");
          return `TK-${year}-${sequence}`;
        }
      }
    } catch {
      // Fallback to countDocuments
    }
  }

  if (typeof ticketModel.countDocuments === "function") {
    const res = ticketModel.countDocuments();
    const count =
      typeof res?.exec === "function" ? await res.exec() : await res;
    nextSeq = Number(count) + 1001;
  }
  const sequence = String(nextSeq).padStart(5, "0");
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
    ticket.sla.firstRespondedAt ??= new Date();
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

function parseStringField(val: unknown): string | undefined {
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (trimmed.length > 0) return trimmed;
  } else if (typeof val === "number") {
    return String(val);
  }
  return undefined;
}

export function extractUserPhone(
  user?: {
    phone?: string | null;
    profile?: Record<string, unknown>;
  } | null,
): string | undefined {
  if (!user) return undefined;
  const directPhone = parseStringField(user.phone);
  if (directPhone) return directPhone;

  const profile = user.profile;
  if (!profile) return undefined;

  const contacto = profile.contacto;
  if (contacto && typeof contacto === "object") {
    const cel = parseStringField((contacto as Record<string, unknown>).celular);
    if (cel) return cel;
  }

  const tel = parseStringField(profile.telefono);
  if (tel) return tel;

  const cel = parseStringField(profile.celular);
  if (cel) return cel;

  return undefined;
}
