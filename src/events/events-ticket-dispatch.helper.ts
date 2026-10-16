import { Logger } from "@nestjs/common";
import { Model } from "mongoose";
import { ConfigService } from "@nestjs/config";
import type { EventRegistrationDocument } from "./schemas/event-registration.schema";
import type { EventDocument } from "./schemas/event.schema";
import type { UserDocument } from "../users/schemas/user.schema";
import type { BirdEmailService } from "../bird/bird-email.service";
import { dispatchConfirmedEventTicketNotification } from "./events-ticket-notification.helper";
import {
  generateCheckInCode,
  buildQrTicketPayload,
} from "./events-checkin.helpers";

export function ensureRegistrationCheckInCode(
  reg: EventRegistrationDocument,
  slug: string,
  userId: string,
): boolean {
  if (!reg.checkInCode) {
    const code = generateCheckInCode("EVT");
    reg.checkInCode = code;
    reg.qrCodeData = buildQrTicketPayload("EVENT", {
      registrationId: String(reg._id),
      slug,
      checkInCode: code,
      userId,
    });
    return true;
  }
  return false;
}

export function dispatchEventTicketIfEligible(
  registration: EventRegistrationDocument,
  eventModel: Model<EventDocument>,
  userModel: Model<UserDocument>,
  birdEmailService: BirdEmailService,
  configService: ConfigService,
  logger: Logger,
  eventSlug: string,
): void {
  const isEligible =
    registration.status === "CONFIRMED" &&
    (registration.paymentConfirmed ||
      registration.membershipStatus === "active-member" ||
      registration.membershipStatus === "non-member-free");

  if (!isEligible) {
    return;
  }

  void (async () => {
    try {
      const event = await eventModel.findOne({ slug: eventSlug });
      if (event) {
        const panelUrl =
          configService.get<string>("PANEL_URL") ?? "https://panel.bskmt.com";
        await dispatchConfirmedEventTicketNotification(
          registration,
          event,
          userModel,
          birdEmailService,
          panelUrl,
          logger,
        );
      }
    } catch (err) {
      logger.error(
        `Failed to dispatch confirmed event ticket for slug=${eventSlug}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  })();
}
