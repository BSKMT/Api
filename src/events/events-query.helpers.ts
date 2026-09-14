import { Model } from "mongoose";
import type { KvCacheService } from "../kv/kv-cache.service";
import { type EventDocument, EventStatus } from "./schemas/event.schema";
import { type CourseDocument, CourseStatus } from "./schemas/course.schema";

export async function queryUpcomingEvents(
  eventModel: Model<EventDocument>,
  kvCache: KvCacheService,
  limit: number = 6,
): Promise<EventDocument[]> {
  const cacheKey = `events:upcoming:${limit}`;
  const cached = await kvCache.get<EventDocument[]>(cacheKey);
  if (cached) return cached;

  const now = new Date();
  const result = await eventModel
    .find({
      status: EventStatus.PUBLISHED,
      date: { $gte: now },
    })
    .sort({ date: 1 })
    .limit(limit)
    .lean();

  await kvCache.set(cacheKey, result, 120);
  return result;
}

export async function queryFeaturedEvents(
  eventModel: Model<EventDocument>,
  kvCache: KvCacheService,
  limit: number = 3,
): Promise<EventDocument[]> {
  const cacheKey = `events:featured:${limit}`;
  const cached = await kvCache.get<EventDocument[]>(cacheKey);
  if (cached) return cached;

  const now = new Date();
  const result = await eventModel
    .find({
      status: EventStatus.PUBLISHED,
      featured: true,
      date: { $gte: now },
    })
    .sort({ date: 1 })
    .limit(limit)
    .lean();

  await kvCache.set(cacheKey, result, 120);
  return result;
}

export async function queryEventBySlug(
  eventModel: Model<EventDocument>,
  kvCache: KvCacheService,
  slug: string,
): Promise<EventDocument | null> {
  const cacheKey = `event:slug:${slug}`;
  const cached = await kvCache.get<EventDocument>(cacheKey);
  if (cached) return cached;

  const result = await eventModel
    .findOne({ slug, status: EventStatus.PUBLISHED })
    .select("-metadata")
    .lean();

  if (result) await kvCache.set(cacheKey, result, 300);
  return result;
}

export async function queryAvailableCourses(
  courseModel: Model<CourseDocument>,
  kvCache: KvCacheService,
  limit: number = 6,
): Promise<CourseDocument[]> {
  const cacheKey = `courses:available:${limit}`;
  const cached = await kvCache.get<CourseDocument[]>(cacheKey);
  if (cached) return cached;

  const result = await courseModel
    .find({ status: CourseStatus.PUBLISHED })
    .sort({ featured: -1, title: 1 })
    .limit(limit)
    .lean();

  await kvCache.set(cacheKey, result, 120);
  return result;
}

export async function queryCourseBySlug(
  courseModel: Model<CourseDocument>,
  kvCache: KvCacheService,
  slug: string,
): Promise<CourseDocument | null> {
  const cacheKey = `course:slug:${slug}`;
  const cached = await kvCache.get<CourseDocument>(cacheKey);
  if (cached) return cached;

  const result = await courseModel
    .findOne({ slug, status: CourseStatus.PUBLISHED })
    .select("-metadata")
    .lean();

  if (result) await kvCache.set(cacheKey, result, 300);
  return result;
}

export async function queryEventStats(
  eventModel: Model<EventDocument>,
  courseModel: Model<CourseDocument>,
  kvCache: KvCacheService,
) {
  const cacheKey = "events:stats";
  const cached = await kvCache.get<{
    totalEvents: number;
    upcomingEvents: number;
    totalCourses: number;
  }>(cacheKey);
  if (cached) return cached;

  const now = new Date();
  const totalEvents = await eventModel.countDocuments({
    status: EventStatus.PUBLISHED,
  });
  const upcomingEvents = await eventModel.countDocuments({
    status: EventStatus.PUBLISHED,
    date: { $gte: now },
  });
  const totalCourses = await courseModel.countDocuments({
    status: CourseStatus.PUBLISHED,
  });

  const result = {
    totalEvents,
    upcomingEvents,
    totalCourses,
  };

  await kvCache.set(cacheKey, result, 300);
  return result;
}
