import { Logger } from "@nestjs/common";
import { BirdContactService } from "../../bird/bird-contact.service";
import { maskEmail } from "../../common/utils/log-redact.util";
import { normalizePhoneNumberHelper } from "../../bird/bird-contact-extraction.helpers";

export async function syncTicketCustomerWithBird(
  birdContactService: BirdContactService,
  customer: {
    name: string;
    email: string;
    phone?: string | null;
    userId?: string | null;
  },
  logger: Logger,
): Promise<string | null> {
  try {
    const parts = customer.name.trim().split(/\s+/);
    const primerNombre = parts[0] || customer.name;
    const primerApellido = parts.slice(1).join(" ") || undefined;
    const normalizedPhone = normalizePhoneNumberHelper(customer.phone);

    const res = await birdContactService.syncContact({
      email: customer.email,
      primerNombre,
      primerApellido,
      phone: normalizedPhone || undefined,
      externalId: customer.userId || undefined,
    });
    if (res.success && res.contactId) {
      logger.log(
        `Cliente ${maskEmail(customer.email)} sincronizado con Bird CRM: ${res.contactId}`,
      );
      return res.contactId;
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(
      `Error al sincronizar cliente ${maskEmail(customer.email)} en Bird CRM: ${msg}`,
    );
  }
  return null;
}
