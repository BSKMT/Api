import { TicketChannel } from "../schemas/ticket.schema";
import { extractUserName } from "./ticket-actions.helper";
import { normalizePhoneNumberHelper } from "../../bird/bird-contact-extraction.helpers";
import { UsersService } from "../../users/users.service";
import { BirdWhatsappService } from "../../bird/bird-whatsapp.service";
import { BirdSmsService } from "../../bird/bird-sms.service";

export async function resolveInboundCustomer(
  params: {
    channel: TicketChannel;
    from: string;
    senderName?: string;
  },
  usersService: UsersService,
): Promise<{
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  userId: string | null;
}> {
  const { channel, from, senderName } = params;
  let customerName = senderName || "Cliente";
  let customerEmail = "";
  let customerPhone: string | null = null;
  let userId: string | null = null;

  if (channel === TicketChannel.EMAIL) {
    customerEmail = from.toLowerCase().trim();
    const user = await usersService
      .findByEmail(customerEmail)
      .catch(() => null);
    if (user) {
      userId = String(user._id);
      customerName = extractUserName(user) || customerName;
      customerPhone = user.phone || null;
    }
  } else {
    customerPhone = normalizePhoneNumberHelper(from) || from;
    const user = await usersService
      .findByPhone(customerPhone)
      .catch(() => null);
    if (user) {
      userId = String(user._id);
      customerName = extractUserName(user) || customerName;
      customerEmail = user.email || "";
    } else {
      const cleanDigits = customerPhone.replace(/\D/g, "");
      customerEmail = `${cleanDigits}@inbound.bskmt.com`;
    }
  }

  return { customerName, customerEmail, customerPhone, userId };
}

export function dispatchInboundAutoResponse(
  channel: TicketChannel,
  ticketNumber: string,
  customerName: string,
  customerPhone: string | null,
  birdWhatsappService: BirdWhatsappService,
  birdSmsService: BirdSmsService,
): void {
  if (!customerPhone) return;

  if (channel === TicketChannel.WHATSAPP) {
    void birdWhatsappService.sendNotificationWhatsapp({
      to: customerPhone,
      title: `Servicio al Cliente BSKMT #${ticketNumber}`,
      message: `¡Hola ${customerName}! 👋 Gracias por comunicarte con el Servicio al Cliente de BSK Motorcycle Team. Hemos recibido tu mensaje y asignado el Ticket #[${ticketNumber}]. Un asesor te atenderá por este mismo canal en el menor tiempo posible.`,
    });
  } else if (channel === TicketChannel.SMS) {
    void birdSmsService.sendNotificationSms({
      to: customerPhone,
      title: `BSKMT #${ticketNumber}`,
      message: `BSKMT: Recibimos tu mensaje [Ticket #${ticketNumber}]. Un asesor te atenderá a la brevedad.`,
    });
  }
}
