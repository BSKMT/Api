import {
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Model } from "mongoose";
import type { CourseDocument } from "./schemas/course.schema";
import type { CourseEnrollmentDocument } from "./schemas/course-enrollment.schema";
import type { CoursePricing } from "./events.constants";
import { calculateCoursePricing } from "./events-course-pricing.helpers";

export { calculateCoursePricing };

export async function reserveCourseSeat(
  courseModel: Model<CourseDocument>,
  course: CourseDocument,
  courseSlug: string,
): Promise<void> {
  const maxCap = course.maxCapacity;
  if (maxCap != null && maxCap > 0) {
    const reserve = await courseModel.findOneAndUpdate(
      {
        slug: courseSlug,
        $expr: {
          $lt: [{ $ifNull: ["$enrolledCount", 0] }, maxCap],
        },
      },
      { $inc: { enrolledCount: 1 } },
    );
    if (!reserve) {
      throw new BadRequestException(
        "El curso ha alcanzado su capacidad máxima",
      );
    }
  } else {
    await courseModel.updateOne(
      { slug: courseSlug },
      { $inc: { enrolledCount: 1 } },
    );
  }
}

export async function incrementCourseEnrollmentCount(
  courseModel: Model<CourseDocument>,
  courseEnrollmentModel: Model<CourseEnrollmentDocument>,
  course: CourseDocument,
  courseSlug: string,
  saved: CourseEnrollmentDocument,
): Promise<void> {
  const maxCap = course.maxCapacity;
  if (maxCap != null && maxCap > 0) {
    const updateResult = await courseModel.findOneAndUpdate(
      {
        slug: courseSlug,
        $expr: {
          $lt: [{ $ifNull: ["$enrolledCount", 0] }, maxCap],
        },
      },
      { $inc: { enrolledCount: 1 } },
    );
    if (!updateResult) {
      await courseEnrollmentModel.deleteOne({ _id: saved._id }).exec();
      throw new BadRequestException(
        "El curso ha alcanzado su capacidad máxima",
      );
    }
  } else {
    await courseModel.updateOne(
      { slug: courseSlug },
      { $inc: { enrolledCount: 1 } },
    );
  }
}

export async function handleReEnrollment(
  courseModel: Model<CourseDocument>,
  existing: CourseEnrollmentDocument,
  course: CourseDocument,
  courseSlug: string,
  userId: string,
  pricing: CoursePricing,
  logger: Logger,
): Promise<{ enrollment: CourseEnrollmentDocument; pricing: CoursePricing }> {
  if (existing.status !== "CANCELLED") {
    throw new ConflictException("Ya estás inscrito en este curso");
  }

  await reserveCourseSeat(courseModel, course, courseSlug);

  existing.status = pricing.requiresPayment ? "PENDING" : "ACTIVE";
  existing.progress = 0;
  existing.paymentConfirmed = !pricing.requiresPayment;
  existing.transactionReference = null;
  existing.completedAt = null;
  existing.certificateId = null;
  try {
    await existing.save();
  } catch (saveErr) {
    await courseModel.findOneAndUpdate(
      { slug: courseSlug, enrolledCount: { $gt: 0 } },
      { $inc: { enrolledCount: -1 } },
    );
    throw saveErr;
  }

  logger.log(
    `Course re-enrollment after cancellation: user=${userId} course=${courseSlug} status=${existing.status} amount=${pricing.amount}`,
  );
  return { enrollment: existing, pricing };
}

export async function handleNewEnrollment(
  courseModel: Model<CourseDocument>,
  courseEnrollmentModel: Model<CourseEnrollmentDocument>,
  userId: string,
  courseSlug: string,
  course: CourseDocument,
  pricing: CoursePricing,
  logger: Logger,
): Promise<{ enrollment: CourseEnrollmentDocument; pricing: CoursePricing }> {
  const enrollment = new courseEnrollmentModel({
    userId,
    courseSlug,
    status: pricing.requiresPayment ? "PENDING" : "ACTIVE",
    progress: 0,
    paymentConfirmed: !pricing.requiresPayment,
  });

  let saved: CourseEnrollmentDocument;
  try {
    saved = await enrollment.save();
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && err.code === 11000) {
      throw new ConflictException("Ya estás inscrito en este curso");
    }
    throw err;
  }

  await incrementCourseEnrollmentCount(
    courseModel,
    courseEnrollmentModel,
    course,
    courseSlug,
    saved,
  );

  logger.log(
    `Course enrollment: user=${userId} course=${courseSlug} status=${enrollment.status} amount=${pricing.amount}`,
  );

  return { enrollment: saved, pricing };
}

export async function executeEnrollInCourse(
  courseModel: Model<CourseDocument>,
  courseEnrollmentModel: Model<CourseEnrollmentDocument>,
  userId: string,
  courseSlug: string,
  membershipLevel: string | null,
  logger: Logger,
): Promise<{ enrollment: CourseEnrollmentDocument; pricing: CoursePricing }> {
  const course = await courseModel.findOne({
    slug: courseSlug,
    status: "published",
  });

  if (!course) {
    throw new NotFoundException("Curso no encontrado");
  }

  const existing = await courseEnrollmentModel.findOne({ userId, courseSlug });
  const pricing = calculateCoursePricing(course, membershipLevel);

  if (existing) {
    return handleReEnrollment(
      courseModel,
      existing,
      course,
      courseSlug,
      userId,
      pricing,
      logger,
    );
  }

  return handleNewEnrollment(
    courseModel,
    courseEnrollmentModel,
    userId,
    courseSlug,
    course,
    pricing,
    logger,
  );
}

export async function executeLinkCoursePayment(
  courseEnrollmentModel: Model<CourseEnrollmentDocument>,
  userId: string,
  courseSlug: string,
  transactionReference: string,
  logger: Logger,
): Promise<CourseEnrollmentDocument> {
  const enrollment = await courseEnrollmentModel.findOneAndUpdate(
    { userId, courseSlug },
    { transactionReference, paymentConfirmed: true, status: "ACTIVE" },
    { new: true },
  );

  if (!enrollment) {
    throw new NotFoundException("Inscripción no encontrada");
  }

  logger.log(
    `Course payment linked: user=${userId} course=${courseSlug} ref=${transactionReference}`,
  );
  return enrollment;
}
