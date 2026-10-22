import {
  TicketPriority,
  TicketSLA,
  TicketStatus,
} from "../schemas/ticket.schema";

export function computeInitialSLA(priority: TicketPriority): TicketSLA {
  const now = new Date();
  let firstResponseHours: number;
  let resolutionHours: number;

  switch (priority) {
    case TicketPriority.URGENTE:
      firstResponseHours = 2;
      resolutionHours = 12;
      break;
    case TicketPriority.ALTA:
      firstResponseHours = 8;
      resolutionHours = 24;
      break;
    case TicketPriority.BAJA:
      firstResponseHours = 48;
      resolutionHours = 96;
      break;
    case TicketPriority.MEDIA:
    default:
      firstResponseHours = 24;
      resolutionHours = 48;
      break;
  }

  const firstResponseDue = new Date(
    now.getTime() + firstResponseHours * 3600 * 1000,
  );
  const resolutionDue = new Date(now.getTime() + resolutionHours * 3600 * 1000);

  return {
    firstResponseDue,
    firstRespondedAt: null,
    resolutionDue,
    resolvedAt: null,
    isSlaBreached: false,
  };
}

export function evaluateSlaBreach(
  sla: TicketSLA,
  status: TicketStatus,
): boolean {
  if (status === TicketStatus.RESUELTO || status === TicketStatus.CERRADO) {
    return sla.isSlaBreached;
  }
  const now = new Date();
  if (!sla.firstRespondedAt && now > sla.firstResponseDue) {
    return true;
  }
  if (now > sla.resolutionDue) {
    return true;
  }
  return false;
}
