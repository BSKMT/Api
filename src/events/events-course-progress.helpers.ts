import { BadRequestException, Logger, NotFoundException } from "@nestjs/common";
import { Model } from "mongoose";
import * as crypto from "node:crypto";
import type { CourseDocument } from "./schemas/course.schema";
import type { CourseEnrollmentDocument } from "./schemas/course-enrollment.schema";
import type { NotificationsService } from "../notifications/notifications.service";
import {
  NotificationType,
  NotificationPriority,
} from "../notifications/schemas/notification.schema";

export async function executeCourseProgress(
  courseEnrollmentModel: Model<CourseEnrollmentDocument>,
  userId: string,
  courseSlug: string,
  progress: number,
): Promise<CourseEnrollmentDocument> {
  const enrollment = await courseEnrollmentModel.findOne({
    userId,
    courseSlug,
  });

  if (!enrollment) {
    throw new NotFoundException("Inscripción no encontrada");
  }

  if (enrollment.status !== "ACTIVE") {
    throw new BadRequestException("La inscripción no está activa");
  }

  const clampedInput = Math.min(100, Math.max(0, progress));
  const MAX_PROGRESS_DELTA_PER_REQUEST = 10;
  const currentProgress = enrollment.progress ?? 0;
  const nextProgress = Math.min(
    100,
    Math.max(currentProgress, clampedInput),
    currentProgress + MAX_PROGRESS_DELTA_PER_REQUEST,
  );
  enrollment.progress = nextProgress;

  if (enrollment.progress === 100 && !enrollment.completedAt) {
    if (!enrollment.paymentConfirmed) {
      throw new BadRequestException(
        "No puedes completar el curso sin un pago confirmado",
      );
    }
    const MIN_LEARNING_TIME_MS = 5 * 60 * 1000;
    const enrolledAt = enrollment.createdAt
      ? new Date(enrollment.createdAt).getTime()
      : 0;
    if (
      Date.now() - enrolledAt > 0 &&
      Date.now() - enrolledAt < MIN_LEARNING_TIME_MS
    ) {
      throw new BadRequestException(
        "Aún no puedes marcar el curso como completado. Avanza por los módulos e inténtalo más tarde.",
      );
    }
    enrollment.status = "COMPLETED";
    enrollment.completedAt = new Date();
    enrollment.certificateId = `BSK-${courseSlug.toUpperCase().slice(0, 3)}-${crypto.randomUUID()}`;
  }

  return enrollment.save();
}

export async function executeCancelCourseEnrollment(
  courseModel: Model<CourseDocument>,
  courseEnrollmentModel: Model<CourseEnrollmentDocument>,
  notificationsService: NotificationsService,
  userId: string,
  courseSlug: string,
  logger: Logger,
): Promise<{ message: string }> {
  const enrollment = await courseEnrollmentModel.findOneAndUpdate(
    { userId, courseSlug, status: { $ne: "CANCELLED" } },
    { status: "CANCELLED" },
    { new: true },
  );

  if (!enrollment) {
    const exists = await courseEnrollmentModel.findOne({
      userId,
      courseSlug,
    });
    if (!exists) {
      throw new NotFoundException("Inscripción no encontrada");
    }
    throw new BadRequestException("La inscripción ya está cancelada");
  }

  await courseModel.findOneAndUpdate(
    { slug: courseSlug, enrolledCount: { $gt: 0 } },
    { $inc: { enrolledCount: -1 } },
  );

  logger.log(
    `Course enrollment cancelled: user=${userId} course=${courseSlug}`,
  );

  if (enrollment.paymentConfirmed && enrollment.transactionReference) {
    logger.warn(
      `REFUND DUE — paid course enrollment cancelled: user=${userId} course=${courseSlug} ref=${enrollment.transactionReference}`,
    );
    try {
      await notificationsService.create({
        userId,
        type: NotificationType.CANCELLATION_REFUND_REQUESTED,
        title: "Cancelación de curso — reembolso en revisión",
        message:
          "Recibimos tu cancelación de un curso pago. Un administrador revisará el reembolso en los próximos días hábiles.",
        priority: NotificationPriority.HIGH,
        metadata: {
          course: courseSlug,
          transactionReference: enrollment.transactionReference,
          refundPending: true,
        },
      });
    } catch {
      // best-effort
    }
  }

  return { message: "Inscripción cancelada exitosamente" };
}
