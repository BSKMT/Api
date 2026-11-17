import { Logger } from "@nestjs/common";
import { BirdEmailService } from "../../bird/bird-email.service";
import { TicketDocument } from "../schemas/ticket.schema";
import { sendTicketCreationNotifications } from "./ticket-creation-notifications.helper";
import { sendTicketReplyNotifications } from "./ticket-reply-notifications.helper";

export { syncTicketCustomerWithBird } from "./ticket-customer-sync.helper";
export type { TicketNotificationContext } from "./ticket-creation-notifications.helper";
export { sendTicketCreationNotifications, sendTicketReplyNotifications };

// Backwards compatibility wrappers
export async function sendTicketCreationEmail(
  birdEmailService: BirdEmailService,
  ticket: TicketDocument,
  logger: Logger,
): Promise<void> {
  await sendTicketCreationNotifications({ birdEmailService, logger }, ticket);
}

export async function sendTicketReplyEmail(
  birdEmailService: BirdEmailService,
  ticket: TicketDocument,
  replyContent: string,
  agentName: string,
  logger: Logger,
): Promise<void> {
  await sendTicketReplyNotifications(
    { birdEmailService, logger },
    ticket,
    replyContent,
    agentName,
    { isInternal: false },
  );
}
