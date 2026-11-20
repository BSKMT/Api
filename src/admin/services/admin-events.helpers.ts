import { BadRequestException, NotFoundException, Logger } from "@nestjs/common";
import { Model } from "mongoose";
import { EventDocument } from "../../events/schemas/event.schema";
import { EventRegistrationDocument } from "../../events/schemas/event-registration.schema";
import type { KvCacheService } from "../../kv/kv-cache.service";
import { parsePositiveInt } from "../../common/utils/pagination.util";

export function clampEventsPagination(rawLimit?: number, rawPage?: number) {
  const limit = parsePositiveInt(rawLimit, 50, 100);
  const page = parsePositiveInt(rawPage, 1, 10000);
  const skip = (page - 1) * limit;
  return { limit, page, skip };
}

export function sanitizeRegistrationsForActor<T>(
  items: T[],
  actorRole?: string,
): T[] {
  const isAdmin = actorRole === "admin" || actorRole === "superadmin";
  if (isAdmin) return items;

  return items.map((r) => {
    if (
      r &&
      typeof r === "object" &&
      "companionData" in r &&
      (r as { companionData?: Record<string, unknown> }).companionData
    ) {
      const copy: Record<string, unknown> = {
        ...(r as Record<string, unknown>),
      };
      const redacted: Record<string, unknown> = {
        ...(copy["companionData"] as Record<string, unknown>),
      };
      delete redacted["documentId"];
      delete redacted["phone"];
      delete redacted["email"];
      copy["companionData"] =
        Object.keys(redacted).length > 0 ? redacted : null;
      return copy as unknown as T;
    }
    return r;
  });
}

export async function incrementSeatOnReconfirm(
  eventModel: Model<EventDocument>,
  eventSlug: string,
): Promise<void> {
  const event = await eventModel.findOne({ slug: eventSlug });
  if (!event) return;

  const maxCap = event.maxCapacity;
  if (maxCap != null && maxCap > 0) {
    const updateResult = await eventModel.findOneAndUpdate(
      {
        slug: eventSlug,
        $expr: {
          $lt: [{ $ifNull: ["$registeredCount", 0] }, maxCap],
        },
      },
      { $inc: { registeredCount: 1 } },
      { new: true },
    );
    if (!updateResult) {
      throw new BadRequestException(
        "El evento ha alcanzado su capacidad máxima",
      );
    }
  } else {
    await eventModel.updateOne(
      { slug: eventSlug },
      { $inc: { registeredCount: 1 } },
    );
  }
}

export async function invalidateEventCacheHelper(
  kvCache: KvCacheService,
  slug?: string,
): Promise<void> {
  await kvCache.delete("events:stats");
  await kvCache.invalidatePrefix("events:upcoming:");
  await kvCache.invalidatePrefix("events:featured:");
  if (slug) await kvCache.delete(`event:slug:${slug}`);
}

export async function executeAdminConfirmRegistration(
  registrationModel: Model<EventRegistrationDocument>,
  eventModel: Model<EventDocument>,
  registrationId: string,
  logger: Logger,
): Promise<EventRegistrationDocument> {
  const registration = await registrationModel.findById(registrationId);
  if (!registration) {
    throw new NotFoundException("Registro no encontrado");
  }
  if (registration.status === "CONFIRMED") {
    throw new BadRequestException("El registro ya está confirmado");
  }

  const prevStatus = registration.status;
  if (prevStatus === "CANCELLED") {
    await incrementSeatOnReconfirm(eventModel, registration.eventSlug);
  }

  const updated = await registrationModel.findOneAndUpdate(
    { _id: registrationId, status: prevStatus },
    { $set: { status: "CONFIRMED", confirmedAt: new Date() } },
    { new: true },
  );
  if (!updated) {
    if (prevStatus === "CANCELLED") {
      await eventModel.updateOne(
        { slug: registration.eventSlug, registeredCount: { $gt: 0 } },
        { $inc: { registeredCount: -1 } },
      );
    }
    throw new BadRequestException(
      "El estado del registro cambió concurrentemente",
    );
  }
  logger.log(`Registration admin-confirmed: id=${registrationId}`);
  return updated;
}

export async function executeAdminCancelRegistration(
  registrationModel: Model<EventRegistrationDocument>,
  eventModel: Model<EventDocument>,
  registrationId: string,
  logger: Logger,
): Promise<EventRegistrationDocument> {
  // M-05: Atomic cancellation prevents double-decrement of registeredCount.
  const updated = await registrationModel.findOneAndUpdate(
    { _id: registrationId, status: { $ne: "CANCELLED" } },
    { $set: { status: "CANCELLED", confirmedAt: null } },
    { new: true },
  );
  if (!updated) {
    const existing = await registrationModel.findById(registrationId).lean();
    if (!existing) {
      throw new NotFoundException("Registro no encontrado");
    }
    throw new BadRequestException("El registro ya está cancelado");
  }

  await eventModel.findOneAndUpdate(
    { slug: updated.eventSlug, registeredCount: { $gt: 0 } },
    { $inc: { registeredCount: -1 } },
  );

  logger.log(`Registration admin-cancelled: id=${registrationId}`);
  return updated;
}
