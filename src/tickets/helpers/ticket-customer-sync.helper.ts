import { Logger } from "@nestjs/common";
import { BirdContactService } from "../../bird/bird-contact.service";
import { maskEmail } from "../../common/utils/log-redact.util";
import { normalizePhoneNumberHelper } from "../../bird/bird-contact-extraction.helpers";
import { isSyntheticInboundEmail } from "../../bird/bird-email.helpers";
import type { UsersService } from "../../users/users.service";

async function syncRegisteredUserIfExists(
  birdContactService: BirdContactService,
  customer: { email: string; userId?: string | null },
  usersService?: UsersService,
): Promise<{ handled: boolean; contactId: string | null }> {
  if (typeof birdContactService.syncUser !== "function") {
    return { handled: false, contactId: null };
  }

  if (customer.userId) {
    const res = await birdContactService.syncUser(customer.userId);
    if (res.success && res.contactId) {
      return { handled: true, contactId: res.contactId };
    }
  }

  if (typeof usersService?.findByEmail === "function") {
    const existing = await usersService
      .findByEmail(customer.email)
      .catch(() => null);
    if (existing) {
      const res = await birdContactService.syncUser(existing);
      return {
        handled: true,
        contactId: res.success && res.contactId ? res.contactId : null,
      };
    }
  }

  return { handled: false, contactId: null };
}

export async function syncTicketCustomerWithBird(
  birdContactService: BirdContactService,
  customer: {
    name: string;
    email: string;
    phone?: string | null;
    userId?: string | null;
  },
  logger: Logger,
  usersService?: UsersService,
): Promise<string | null> {
  if (!customer.email || isSyntheticInboundEmail(customer.email)) {
    return null;
  }

  try {
    const registered = await syncRegisteredUserIfExists(
      birdContactService,
      customer,
      usersService,
    );
    if (registered.handled) {
      if (registered.contactId) {
        logger.log(
          `Cliente registrado ${maskEmail(customer.email)} sincronizado con Bird CRM preservando rol/membresía: ${registered.contactId}`,
        );
      }
      return registered.contactId;
    }

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
