import { BadRequestException } from "@nestjs/common";
import { Model } from "mongoose";
import { EventDocument } from "../../events/schemas/event.schema";
import type { KvCacheService } from "../../kv/kv-cache.service";

export function clampEventsPagination(rawLimit?: number, rawPage?: number) {
  const limit = Math.min(Math.max(rawLimit ?? 50, 1), 100);
  const page = Math.max(rawPage ?? 1, 1);
  const skip = (page - 1) * limit;
  return { limit, page, skip };
}

export function sanitizeRegistrationsForActor<T>(
  items: T[],
  actorRole?: string,
): T[] {
  const isAdmin = actorRole === "admin";
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
        Object.keys(redacted).length > 0 ? redacted : copy["companionData"];
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
