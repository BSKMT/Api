import { BadRequestException, Logger, NotFoundException } from "@nestjs/common";
import { Model } from "mongoose";
import type { EventDocument } from "./schemas/event.schema";
import type { EventRegistrationDocument } from "./schemas/event-registration.schema";
import type { CourseDocument } from "./schemas/course.schema";
import type { CourseEnrollmentDocument } from "./schemas/course-enrollment.schema";
import type { NotificationsService } from "../notifications/notifications.service";
import {
  NotificationType,
  NotificationPriority,
} from "../notifications/schemas/notification.schema";

export async function executeCancelRegistration(
  eventModel: Model<EventDocument>,
  eventRegistrationModel: Model<EventRegistrationDocument>,
  notificationsService: NotificationsService,
  userId: string,
  eventSlug: string,
  logger: Logger,
): Promise<{ message: string }> {
  const registration = await eventRegistrationModel.findOneAndUpdate(
    { userId, eventSlug, status: { $ne: "CANCELLED" } },
    { status: "CANCELLED", confirmedAt: null },
    { new: true },
  );

  if (!registration) {
    const exists = await eventRegistrationModel.findOne({
      userId,
      eventSlug,
    });
    if (!exists) {
      throw new NotFoundException("Registro no encontrado");
    }
    throw new BadRequestException("El registro ya está cancelado");
  }

  await eventModel.findOneAndUpdate(
    { slug: eventSlug, registeredCount: { $gt: 0 } },
    { $inc: { registeredCount: -1 } },
  );

  logger.log(`Registration cancelled: user=${userId} event=${eventSlug}`);

  if (registration.paymentConfirmed && registration.transactionReference) {
    logger.warn(
      `REFUND DUE — paid event registration cancelled: user=${userId} event=${eventSlug} ref=${registration.transactionReference}`,
    );
    try {
      await notificationsService.create({
        userId,
        type: NotificationType.CANCELLATION_REFUND_REQUESTED,
        title: "Cancelación de registro — reembolso en revisión",
        message:
          "Recibimos tu cancelación de un registro pago. Un administrador revisará el reembolso en los próximos días hábiles.",
        priority: NotificationPriority.HIGH,
        metadata: {
          event: eventSlug,
          transactionReference: registration.transactionReference,
          refundPending: true,
        },
      });
    } catch {
      // best-effort
    }
  }

  return { message: "Registro cancelado exitosamente" };
}

export async function executeSweepStaleRegistrations(
  eventModel: Model<EventDocument>,
  eventRegistrationModel: Model<EventRegistrationDocument>,
  courseModel: Model<CourseDocument>,
  courseEnrollmentModel: Model<CourseEnrollmentDocument>,
  now: Date,
  logger: Logger,
): Promise<{ eventsCancelled: number; coursesCancelled: number }> {
  const STALE_TTL_MS = 48 * 60 * 60 * 1000;
  const cutoff = new Date(now.getTime() - STALE_TTL_MS);

  const staleRegs = await eventRegistrationModel
    .find({
      status: "PENDING",
      createdAt: { $lt: cutoff },
      paymentConfirmed: { $ne: true },
      transactionReference: null,
    })
    .limit(500);

  let eventsCancelled = 0;
  for (const reg of staleRegs) {
    const cancelled = await eventRegistrationModel.findOneAndUpdate(
      { _id: reg._id, status: "PENDING" },
      { status: "CANCELLED", confirmedAt: null },
      { new: true },
    );
    if (!cancelled) continue;
    await eventModel.findOneAndUpdate(
      { slug: reg.eventSlug, registeredCount: { $gt: 0 } },
      { $inc: { registeredCount: -1 } },
    );
    eventsCancelled++;
  }

  const staleEnrollments = await courseEnrollmentModel
    .find({
      status: "PENDING",
      createdAt: { $lt: cutoff },
      paymentConfirmed: { $ne: true },
      transactionReference: null,
    })
    .limit(500);

  let coursesCancelled = 0;
  for (const enr of staleEnrollments) {
    const cancelled = await courseEnrollmentModel.findOneAndUpdate(
      { _id: enr._id, status: "PENDING" },
      { status: "CANCELLED" },
      { new: true },
    );
    if (!cancelled) continue;
    await courseModel.findOneAndUpdate(
      { slug: enr.courseSlug, enrolledCount: { $gt: 0 } },
      { $inc: { enrolledCount: -1 } },
    );
    coursesCancelled++;
  }

  logger.log(
    `sweepStaleRegistrations: ${eventsCancelled} events, ${coursesCancelled} courses released`,
  );
  return { eventsCancelled, coursesCancelled };
}
