import { Logger } from "@nestjs/common";
import { BirdEmailService } from "../../bird/bird-email.service";
import { TicketDocument } from "../schemas/ticket.schema";
import { syncTicketCustomerWithBird } from "./ticket-customer-sync.helper";
import {
  TicketNotificationContext,
  sendTicketCreationNotifications,
} from "./ticket-creation-notifications.helper";
import { sendTicketReplyNotifications } from "./ticket-reply-notifications.helper";

export type { TicketNotificationContext };
export {
  syncTicketCustomerWithBird,
  sendTicketCreationNotifications,
  sendTicketReplyNotifications,
};

// Backwards compatibility wrappers
export async function sendTicketCreationEmail(
  birdEmailService: BirdEmailService,
  ticket: TicketDocument,
  logger: Logger,
): Promise<void> {
  return sendTicketCreationNotifications({ birdEmailService, logger }, ticket);
}

export async function sendTicketReplyEmail(
  birdEmailService: BirdEmailService,
  ticket: TicketDocument,
  replyContent: string,
  agentName: string,
  logger: Logger,
): Promise<void> {
  return sendTicketReplyNotifications(
    { birdEmailService, logger },
    ticket,
    replyContent,
    agentName,
    { isInternal: false },
  );
}
