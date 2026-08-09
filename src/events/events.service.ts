import {
  Injectable,
  Logger,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import * as crypto from "node:crypto";
import { KvCacheService } from "../kv/kv-cache.service";
import {
  EventRegistration,
  EventRegistrationDocument,
} from "./schemas/event-registration.schema";
import { Event, EventDocument, EventStatus } from "./schemas/event.schema";
import { Course, CourseDocument, CourseStatus } from "./schemas/course.schema";
import {
  CourseEnrollment,
  CourseEnrollmentDocument,
} from "./schemas/course-enrollment.schema";
import { RegisterEventDto } from "./dto/register-event.dto";
import { SubmitCompanionDto } from "./dto/submit-companion.dto";
// M-4: emit refund-pending notifications when a paid registration /
// course enrollment is cancelled.
import { NotificationsService } from "../notifications/notifications.service";
import {
  NotificationType,
  NotificationPriority,
} from "../notifications/schemas/notification.schema";

export interface CoursePricing {
  amount: number;
  tier: string;
  requiresPayment: boolean;
}

export const MEMBER_LEVELS = new Set([
  "Legend",
  "Friend",
  "Rider",
  "Expert",
  "Master",
]);

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    @InjectModel(EventRegistration.name)
    private readonly eventRegistrationModel: Model<EventRegistrationDocument>,
    @InjectModel(Event.name)
    private readonly eventModel: Model<EventDocument>,
    @InjectModel(Course.name)
    private readonly courseModel: Model<CourseDocument>,
    @InjectModel(CourseEnrollment.name)
    private readonly courseEnrollmentModel: Model<CourseEnrollmentDocument>,
    private readonly notificationsService: NotificationsService,
    private readonly kvCache: KvCacheService,
  ) {}

  async registerForEvent(
    userId: string,
    dto: RegisterEventDto,
    membershipLevel: string | null,
  ): Promise<EventRegistrationDocument> {
    // A-2: Verify the event exists and is PUBLISHED
    const event = await this.eventModel.findOne({ slug: dto.eventSlug });
    if (!event) {
      throw new NotFoundException("Evento no encontrado");
    }
    if (event.status !== EventStatus.PUBLISHED) {
      throw new BadRequestException(
        "El evento no está disponible para registro",
      );
    }

    // M17: Prevent registration in past events
    if (new Date(event.date) < new Date()) {
      throw new BadRequestException(
        "No puedes registrarte en un evento que ya ocurrió",
      );
    }

    const existing = await this.eventRegistrationModel.findOne({
      userId,
      eventSlug: dto.eventSlug,
    });

    if (existing && existing.status !== "CANCELLED") {
      throw new ConflictException("Ya estás registrado para este evento");
    }

    const isMember = MEMBER_LEVELS.has(membershipLevel ?? "");

    let membershipStatus: string;

    // A4/A5: self-managed is only for non-members (always free);
    // members use "active-member" which is free on `membersFree: true`
    // events. On `membersFree: false` events, members are routed through
    // `member-paid` which demands full payment before confirmation
    // (closing the bypass reported in H-2/A-4).
    if (isMember) {
      membershipStatus = event.membersFree ? "active-member" : "member-paid";
    } else if (dto.registrationType === "managed") {
      membershipStatus = "non-member-paid";
    } else {
      membershipStatus = "non-member-free";
    }

    let status = "PENDING";

    // Only members on free events going solo are auto-confirmed.
    if (membershipStatus === "active-member" && dto.attendanceMode === "solo") {
      status = "CONFIRMED";
    }

    if (existing) {
      existing.registrationType = dto.registrationType;
      existing.attendanceMode = dto.attendanceMode;
      existing.status = status;
      existing.membershipStatus = membershipStatus;
      existing.confirmedAt = status === "CONFIRMED" ? new Date() : null;
      existing.paymentConfirmed = false;
      existing.waiverAccepted = false;
      existing.waiverAcceptedAt = null;
      existing.transactionReference = null;
      existing.companionData = null;
      // A6: Increment counter BEFORE save to prevent ghost registrations on capacity full
      await this.incrementEventRegisteredCount(dto.eventSlug, event);
      const saved = await existing.save();
      this.logger.log(
        `Event re-registration after cancellation: user=${userId} event=${dto.eventSlug} status=${status}`,
      );
      return saved;
    }

    const registration = new this.eventRegistrationModel({
      userId,
      eventSlug: dto.eventSlug,
      registrationType: dto.registrationType,
      attendanceMode: dto.attendanceMode,
      status,
      membershipStatus,
      confirmedAt: status === "CONFIRMED" ? new Date() : null,
    });

    const saved = await registration.save();
    // A-10/A-1: Atomic counter increment with capacity check
    try {
      await this.incrementEventRegisteredCount(dto.eventSlug, event);
    } catch (err) {
      // Race condition: capacity was reached between our check and the increment.
      // Rollback the registration to maintain consistency.
      await this.eventRegistrationModel.deleteOne({ _id: saved._id }).exec();
      throw err;
    }
    this.logger.log(
      `Event registration: user=${userId} event=${dto.eventSlug} status=${status}`,
    );
    return saved;
  }

  /**
   * Atomically increment registeredCount if capacity allows.
   * Throws BadRequestException if capacity is exceeded.
   */
  private async incrementEventRegisteredCount(
    eventSlug: string,
    event: { maxCapacity?: number | null },
  ): Promise<void> {
    const maxCap = event.maxCapacity;
    let updateResult;

    if (maxCap != null && maxCap > 0) {
      updateResult = await this.eventModel.findOneAndUpdate(
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
      await this.eventModel.updateOne(
        { slug: eventSlug },
        { $inc: { registeredCount: 1 } },
      );
    }
  }

  async confirmRegistration(
    userId: string,
    eventSlug: string,
  ): Promise<EventRegistrationDocument> {
    const registration = await this.eventRegistrationModel.findOne({
      userId,
      eventSlug,
    });

    if (!registration) {
      throw new NotFoundException("Registro no encontrado");
    }

    if (registration.status === "CONFIRMED") {
      throw new BadRequestException("El registro ya está confirmado");
    }

    this.validateConfirmationPrerequisites(registration);

    // M19: If re-confirming a CANCELLED registration, re-increment the seat count
    if (registration.status === "CANCELLED") {
      const event = await this.eventModel.findOne({ slug: eventSlug });
      if (event) {
        try {
          await this.incrementEventRegisteredCount(eventSlug, event);
        } catch {
          throw new BadRequestException(
            "El evento ha alcanzado su capacidad máxima",
          );
        }
      }
    }

    registration.status = "CONFIRMED";
    registration.confirmedAt = new Date();
    const saved = await registration.save();
    this.logger.log(
      `Registration confirmed: user=${userId} event=${eventSlug}`,
    );
    return saved;
  }

  private validateConfirmationPrerequisites(
    registration: EventRegistrationDocument,
  ): void {
    const { membershipStatus, attendanceMode } = registration;

    const isMemberPaidSolo =
      membershipStatus === "member-paid" && attendanceMode === "solo";
    const isMemberPaidWithCompanion =
      membershipStatus === "member-paid" && attendanceMode === "with-companion";
    const isMemberFreeSolo =
      membershipStatus === "active-member" && attendanceMode === "solo";
    const isMemberFreeWithCompanion =
      membershipStatus === "active-member" &&
      attendanceMode === "with-companion";
    const isNonMemberPaid = membershipStatus === "non-member-paid";
    const isNonMemberFreeSolo =
      membershipStatus === "non-member-free" && attendanceMode === "solo";
    const isNonMemberFreeWithCompanion =
      membershipStatus === "non-member-free" &&
      attendanceMode === "with-companion";

    // A-4: Members on a paid event pay the same way a non-member does.
    if (isMemberPaidSolo) {
      this.requirePayment(registration);
      this.requireWaiver(registration);
      return;
    }
    if (isMemberPaidWithCompanion) {
      this.requirePayment(registration);
      this.requireCompanionData(registration);
      this.requireWaiver(registration);
      return;
    }

    if (isMemberFreeSolo) {
      return;
    }

    if (isMemberFreeWithCompanion) {
      this.requirePayment(registration);
      this.requireCompanionData(registration);
      return;
    }

    if (isNonMemberPaid) {
      this.requirePayment(registration);
      if (attendanceMode === "with-companion") {
        this.requireCompanionData(registration);
      }
      return;
    }

    if (isNonMemberFreeSolo) {
      this.requireWaiver(registration);
      return;
    }

    if (isNonMemberFreeWithCompanion) {
      this.requireWaiver(registration);
      this.requireCompanionData(registration);
    }
  }

  private requirePayment(registration: EventRegistrationDocument): void {
    if (!registration.paymentConfirmed) {
      throw new BadRequestException(
        registration.membershipStatus === "active-member"
          ? "Pago del acompañante pendiente"
          : "Pago pendiente",
      );
    }
  }

  private requireCompanionData(registration: EventRegistrationDocument): void {
    if (!registration.companionData) {
      throw new BadRequestException("Datos del acompañante requeridos");
    }
  }

  private requireWaiver(registration: EventRegistrationDocument): void {
    if (!registration.waiverAccepted) {
      throw new BadRequestException(
        "Debes aceptar la exoneración de responsabilidad",
      );
    }
  }

  async acceptWaiver(
    userId: string,
    eventSlug: string,
    clientIp?: string,
  ): Promise<EventRegistrationDocument> {
    // EVT-17: Store IP/UA for waiver audit trail
    const registration = await this.eventRegistrationModel.findOneAndUpdate(
      { userId, eventSlug },
      {
        waiverAccepted: true,
        waiverAcceptedAt: new Date(),
        waiverAcceptedIp: clientIp ?? null,
      },
      { new: true },
    );

    if (!registration) {
      throw new NotFoundException("Registro no encontrado");
    }

    this.logger.log(`Waiver accepted: user=${userId} event=${eventSlug}`);
    return registration;
  }

  async submitCompanionData(
    userId: string,
    eventSlug: string,
    dto: SubmitCompanionDto,
  ): Promise<EventRegistrationDocument> {
    const existing = await this.eventRegistrationModel.findOne({
      userId,
      eventSlug,
    });
    if (!existing) {
      throw new NotFoundException("Registro no encontrado");
    }
    // M-10: refuse to overwrite an already-confirmed companion waiver
    // audit trail. The companion's PII + waiver were collected and
    // validated before confirmation; swapping them post-confirmation
    // would defeat the audit trail and allow sneaking in an attendee
    // who never went through the waiver/payment steps. To swap, the
    // user must cancel and re-register (which re-runs validation).
    if (existing.status === "CONFIRMED" && existing.companionData) {
      throw new BadRequestException(
        "El acompañante ya fue registrado en una inscripción confirmada. Cancela y vuelve a inscribirte para cambiarlo.",
      );
    }

    const registration = await this.eventRegistrationModel.findOneAndUpdate(
      { userId, eventSlug },
      { companionData: dto },
      { new: true },
    );

    this.logger.log(
      `Companion data submitted: user=${userId} event=${eventSlug}`,
    );
    return registration as EventRegistrationDocument;
  }

  async linkPayment(
    userId: string,
    eventSlug: string,
    transactionReference: string,
  ): Promise<EventRegistrationDocument> {
    const registration = await this.eventRegistrationModel.findOneAndUpdate(
      { userId, eventSlug },
      { transactionReference, paymentConfirmed: true },
      { new: true },
    );

    if (!registration) {
      throw new NotFoundException("Registro no encontrado");
    }

    this.logger.log(
      `Payment linked: user=${userId} event=${eventSlug} ref=${transactionReference}`,
    );

    try {
      await this.confirmRegistration(userId, eventSlug);
      this.logger.log(
        `Auto-confirmed after payment: user=${userId} event=${eventSlug}`,
      );
    } catch {
      this.logger.warn(
        `Auto-confirm skipped (prerequisites pending): user=${userId} event=${eventSlug}`,
      );
    }

    return registration;
  }

  async getRegistration(
    userId: string,
    eventSlug: string,
  ): Promise<EventRegistrationDocument | null> {
    return this.eventRegistrationModel.findOne({ userId, eventSlug });
  }

  async getRegistrationsByUser(
    userId: string,
  ): Promise<EventRegistrationDocument[]> {
    return this.eventRegistrationModel.find({ userId }).sort({ createdAt: -1 });
  }

  async getUpcomingEvents(limit: number = 6): Promise<EventDocument[]> {
    const cacheKey = `events:upcoming:${limit}`;
    const cached = await this.kvCache.get<EventDocument[]>(cacheKey);
    if (cached) return cached;

    const now = new Date();
    const result = await this.eventModel
      .find({
        status: EventStatus.PUBLISHED,
        date: { $gte: now },
      })
      .sort({ date: 1 })
      .limit(limit)
      .lean();

    await this.kvCache.set(cacheKey, result, 120);
    return result;
  }

  async getFeaturedEvents(limit: number = 3): Promise<EventDocument[]> {
    const cacheKey = `events:featured:${limit}`;
    const cached = await this.kvCache.get<EventDocument[]>(cacheKey);
    if (cached) return cached;

    const now = new Date();
    const result = await this.eventModel
      .find({
        status: EventStatus.PUBLISHED,
        featured: true,
        date: { $gte: now },
      })
      .sort({ date: 1 })
      .limit(limit)
      .lean();

    await this.kvCache.set(cacheKey, result, 120);
    return result;
  }

  async getEventBySlug(slug: string): Promise<EventDocument | null> {
    const cacheKey = `event:slug:${slug}`;
    const cached = await this.kvCache.get<EventDocument>(cacheKey);
    if (cached) return cached;

    const result = await this.eventModel
      .findOne({ slug, status: EventStatus.PUBLISHED })
      .select("-metadata")
      .lean();

    if (result) await this.kvCache.set(cacheKey, result, 300);
    return result;
  }

  async getAvailableCourses(limit: number = 6): Promise<CourseDocument[]> {
    const cacheKey = `courses:available:${limit}`;
    const cached = await this.kvCache.get<CourseDocument[]>(cacheKey);
    if (cached) return cached;

    const result = await this.courseModel
      .find({ status: CourseStatus.PUBLISHED })
      .sort({ featured: -1, title: 1 })
      .limit(limit)
      .lean();

    await this.kvCache.set(cacheKey, result, 120);
    return result;
  }

  async getCourseBySlug(slug: string): Promise<CourseDocument | null> {
    const cacheKey = `course:slug:${slug}`;
    const cached = await this.kvCache.get<CourseDocument>(cacheKey);
    if (cached) return cached;

    const result = await this.courseModel
      .findOne({ slug, status: CourseStatus.PUBLISHED })
      .select("-metadata")
      .lean();

    if (result) await this.kvCache.set(cacheKey, result, 300);
    return result;
  }

  async getEventStats() {
    const cacheKey = "events:stats";
    const cached = await this.kvCache.get<{
      totalEvents: number;
      upcomingEvents: number;
      totalCourses: number;
    }>(cacheKey);
    if (cached) return cached;

    const now = new Date();
    const totalEvents = await this.eventModel.countDocuments({
      status: EventStatus.PUBLISHED,
    });
    const upcomingEvents = await this.eventModel.countDocuments({
      status: EventStatus.PUBLISHED,
      date: { $gte: now },
    });
    const totalCourses = await this.courseModel.countDocuments({
      status: CourseStatus.PUBLISHED,
    });

    const result = {
      totalEvents,
      upcomingEvents,
      totalCourses,
    };

    await this.kvCache.set(cacheKey, result, 300);
    return result;
  }

  async cancelRegistration(
    userId: string,
    eventSlug: string,
  ): Promise<{ message: string }> {
    // A-10: Use atomic findOneAndUpdate with status guard to prevent
    //       double-decrement race conditions.
    const registration = await this.eventRegistrationModel.findOneAndUpdate(
      { userId, eventSlug, status: { $ne: "CANCELLED" } },
      { status: "CANCELLED", confirmedAt: null },
      { new: true },
    );

    if (!registration) {
      // Could be not found, or already cancelled. Distinguish:
      const exists = await this.eventRegistrationModel.findOne({
        userId,
        eventSlug,
      });
      if (!exists) {
        throw new NotFoundException("Registro no encontrado");
      }
      throw new BadRequestException("El registro ya está cancelado");
    }

    // A-10: Atomic decrement guard prevents going below 0
    await this.eventModel.findOneAndUpdate(
      { slug: eventSlug, registeredCount: { $gt: 0 } },
      { $inc: { registeredCount: -1 } },
    );

    this.logger.log(
      `Registration cancelled: user=${userId} event=${eventSlug}`,
    );

    // M-4: If the registration had been paid, surface a refund-pending
    // notification so the user knows we will issue a refund once an
    // admin reviews it. The admin triages via the notification feed +
    // server logs ("REFUND DUE"); a future dedicated admin refund list
    // can filter by NotificationType.CANCELLATION_REFUND_REQUESTED.
    if (registration.paymentConfirmed && registration.transactionReference) {
      this.logger.warn(
        `REFUND DUE — paid event registration cancelled: user=${userId} event=${eventSlug} ref=${registration.transactionReference}`,
      );
      try {
        await this.notificationsService.create({
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
        // notifications are best-effort; never break the cancellation
        // flow if the notification system is down.
      }
    }

    return { message: "Registro cancelado exitosamente" };
  }

  async enrollInCourse(
    userId: string,
    courseSlug: string,
    membershipLevel: string | null,
  ): Promise<{ enrollment: CourseEnrollmentDocument; pricing: CoursePricing }> {
    const course = await this.courseModel.findOne({
      slug: courseSlug,
      status: CourseStatus.PUBLISHED,
    });

    if (!course) {
      throw new NotFoundException("Curso no encontrado");
    }

    const existing = await this.courseEnrollmentModel.findOne({
      userId,
      courseSlug,
    });

    const pricing = this.calculateCoursePricing(course, membershipLevel);

    if (existing) {
      // EVT-16: Allow re-enrollment after cancellation, reject if still active
      if (existing.status !== "CANCELLED") {
        throw new ConflictException("Ya estás inscrito en este curso");
      }
      // M-6: reserve the capacity FIRST so a full-course failure leaves
      // the enrollment document in CANCELLED state (recoverable) and
      // does NOT silently flip the user to PENDING-without-seat which
      // would otherwise leave them permanently stuck.
      const maxCap = course.maxCapacity;
      if (maxCap != null && maxCap > 0) {
        const reserve = await this.courseModel.findOneAndUpdate(
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
        await this.courseModel.updateOne(
          { slug: courseSlug },
          { $inc: { enrolledCount: 1 } },
        );
      }
      // Re-activate cancelled enrollment, clear residual paymentConfirmed
      existing.status = pricing.requiresPayment ? "PENDING" : "ACTIVE";
      existing.progress = 0;
      existing.paymentConfirmed = !pricing.requiresPayment;
      existing.transactionReference = null;
      existing.completedAt = null;
      existing.certificateId = null;
      try {
        await existing.save();
      } catch (saveErr) {
        // M-6: roll back the seat we just reserved so the user can
        // retry later; otherwise their second attempt would also see
        // no capacity and be stuck as a cancelled enrollment.
        await this.courseModel.findOneAndUpdate(
          { slug: courseSlug, enrolledCount: { $gt: 0 } },
          { $inc: { enrolledCount: -1 } },
        );
        throw saveErr;
      }

      this.logger.log(
        `Course re-enrollment after cancellation: user=${userId} course=${courseSlug} status=${existing.status} amount=${pricing.amount}`,
      );
      return { enrollment: existing, pricing };
    }

    const enrollment = new this.courseEnrollmentModel({
      userId,
      courseSlug,
      status: pricing.requiresPayment ? "PENDING" : "ACTIVE",
      progress: 0,
      paymentConfirmed: !pricing.requiresPayment,
    });

    // M15: Handle E11000 race on unique index { userId, courseSlug }
    let saved: CourseEnrollmentDocument;
    try {
      saved = await enrollment.save();
    } catch (err: unknown) {
      if (
        err &&
        typeof err === "object" &&
        "code" in err &&
        err.code === 11000
      ) {
        throw new ConflictException("Ya estás inscrito en este curso");
      }
      throw err;
    }

    // M15: Atomic capacity-aware increment with rollback on full
    const maxCap = course.maxCapacity;
    if (maxCap != null && maxCap > 0) {
      const updateResult = await this.courseModel.findOneAndUpdate(
        {
          slug: courseSlug,
          $expr: {
            $lt: [{ $ifNull: ["$enrolledCount", 0] }, maxCap],
          },
        },
        { $inc: { enrolledCount: 1 } },
      );
      if (!updateResult) {
        await this.courseEnrollmentModel.deleteOne({ _id: saved._id }).exec();
        throw new BadRequestException(
          "El curso ha alcanzado su capacidad máxima",
        );
      }
    } else {
      await this.courseModel.updateOne(
        { slug: courseSlug },
        { $inc: { enrolledCount: 1 } },
      );
    }

    this.logger.log(
      `Course enrollment: user=${userId} course=${courseSlug} status=${enrollment.status} amount=${pricing.amount}`,
    );

    return { enrollment: saved, pricing };
  }

  calculateCoursePricing(
    course: {
      nonMemberPrice: number | null;
      format: string;
      membersFree: boolean;
      memberSemipresencialDiscount: number | null;
      memberPresencialDiscount: number | null;
    },
    membershipLevel: string | null,
  ): CoursePricing {
    const isMember = MEMBER_LEVELS.has(membershipLevel ?? "");

    const basePrice = course.nonMemberPrice ?? 0;

    if (!isMember) {
      return {
        amount: basePrice,
        tier: "course-non-member",
        requiresPayment: basePrice > 0,
      };
    }

    const virtualPricing: CoursePricing = {
      amount: 0,
      tier: "course-member-virtual",
      requiresPayment: false,
    };

    switch (course.format) {
      case "virtual":
        return virtualPricing;
      case "semipresencial":
        return {
          amount: Math.round(
            basePrice * ((course.memberSemipresencialDiscount ?? 25) / 100),
          ),
          tier: "course-member-semipresencial",
          requiresPayment: basePrice > 0,
        };
      case "presencial":
        return {
          amount: Math.round(
            basePrice * ((course.memberPresencialDiscount ?? 50) / 100),
          ),
          tier: "course-member-presencial",
          requiresPayment: basePrice > 0,
        };
      default:
        return virtualPricing;
    }
  }

  async cancelCourseEnrollment(
    userId: string,
    courseSlug: string,
  ): Promise<{ message: string }> {
    // A-10: Atomic findOneAndUpdate with status guard
    const enrollment = await this.courseEnrollmentModel.findOneAndUpdate(
      { userId, courseSlug, status: { $ne: "CANCELLED" } },
      { status: "CANCELLED" },
      { new: true },
    );

    if (!enrollment) {
      const exists = await this.courseEnrollmentModel.findOne({
        userId,
        courseSlug,
      });
      if (!exists) {
        throw new NotFoundException("Inscripción no encontrada");
      }
      throw new BadRequestException("La inscripción ya está cancelada");
    }

    // A-10: Atomic decrement guard prevents going below 0
    await this.courseModel.findOneAndUpdate(
      { slug: courseSlug, enrolledCount: { $gt: 0 } },
      { $inc: { enrolledCount: -1 } },
    );

    this.logger.log(
      `Course enrollment cancelled: user=${userId} course=${courseSlug}`,
    );

    // M-4: paid course cancellation → refund-pending notification +
    // explicit server log so admins can see "REFUND DUE".
    if (enrollment.paymentConfirmed && enrollment.transactionReference) {
      this.logger.warn(
        `REFUND DUE — paid course enrollment cancelled: user=${userId} course=${courseSlug} ref=${enrollment.transactionReference}`,
      );
      try {
        await this.notificationsService.create({
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
        // best-effort: don't break cancellation
      }
    }

    return { message: "Inscripción cancelada exitosamente" };
  }

  async updateCourseProgress(
    userId: string,
    courseSlug: string,
    progress: number,
  ): Promise<CourseEnrollmentDocument> {
    const enrollment = await this.courseEnrollmentModel.findOne({
      userId,
      courseSlug,
    });

    if (!enrollment) {
      throw new NotFoundException("Inscripción no encontrada");
    }

    if (enrollment.status !== "ACTIVE") {
      throw new BadRequestException("La inscripción no está activa");
    }

    // A-3: Progress is monotonic AND rate-limited — clients may only
    // advance by a bounded delta per request. The previous
    // `Math.max(...)` was a no-op against a single 0→100 jump, which let
    // a member mint a certificate in seconds on a free course. Cap the
    // delta at MAX_PROGRESS_DELTA_PER_REQUEST (e.g., 10%) so a course
    // must be visited in at least ~10 calls; combined with the
    // `learningStartedAt` minimum time window further down this is a
    // defense-in-depth anti-fraud measure.
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
      // A-3: Defense-in-depth — require at least MIN_LEARNING_TIME_MS
      // between enrollment and completion. The delta cap forces ≥10
      // separate calls but a bot could fire them instantly; this gate
      // stops "complete in under a minute" fraud.
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

  async linkCoursePayment(
    userId: string,
    courseSlug: string,
    transactionReference: string,
  ): Promise<CourseEnrollmentDocument> {
    const enrollment = await this.courseEnrollmentModel.findOneAndUpdate(
      { userId, courseSlug },
      {
        transactionReference,
        paymentConfirmed: true,
        status: "ACTIVE",
      },
      { new: true },
    );

    if (!enrollment) {
      throw new NotFoundException("Inscripción no encontrada");
    }

    this.logger.log(
      `Course payment linked: user=${userId} course=${courseSlug} ref=${transactionReference}`,
    );

    return enrollment;
  }

  async getMyEnrollments(
    userId: string,
    includeCancelled = false,
  ): Promise<CourseEnrollmentDocument[]> {
    const filter: Record<string, unknown> = { userId };
    if (!includeCancelled) {
      filter.status = { $ne: "CANCELLED" };
    }
    return this.courseEnrollmentModel.find(filter).sort({ createdAt: -1 });
  }

  async getEnrollmentByUserAndCourse(
    userId: string,
    courseSlug: string,
  ): Promise<CourseEnrollmentDocument | null> {
    return this.courseEnrollmentModel.findOne({ userId, courseSlug });
  }

  /**
   * M-5: Stale-registration sweeper. Atomically marks as CANCELLED any
   * PENDING event-registration or course enrollment whose
   * `paymentConfirmed` is still false AND no `transactionReference`
   * has been recorded, AND which has been pending for at least
   * `STALE_TTL_MS` (48h). Each successful cancellation also
   * decrements the registered/enrolled count on the parent document
   * with the `$gt: 0` floor so counts never go negative.
   *
   * Designed to be invoked by Vercel Cron every 12h — abandoned
   * registrations otherwise retain their seat forever (a flock of
   * throw-away sign-ups could starve a real attendee).
   */
  async sweepStaleRegistrations(now: Date = new Date()): Promise<{
    eventsCancelled: number;
    coursesCancelled: number;
  }> {
    const STALE_TTL_MS = 48 * 60 * 60 * 1000;
    const cutoff = new Date(now.getTime() - STALE_TTL_MS);

    // 1. Event registrations: PENDING + createdAt < cutoff + no
    //    paymentConfirmed + no transactionReference.
    const staleRegs = await this.eventRegistrationModel
      .find({
        status: "PENDING",
        createdAt: { $lt: cutoff },
        paymentConfirmed: { $ne: true },
        transactionReference: null,
      })
      .limit(500);

    let eventsCancelled = 0;
    for (const reg of staleRegs) {
      const cancelled = await this.eventRegistrationModel.findOneAndUpdate(
        { _id: reg._id, status: "PENDING" },
        { status: "CANCELLED", confirmedAt: null },
        { new: true },
      );
      if (!cancelled) continue; // someone confirmed/cancelled concurrently
      await this.eventModel.findOneAndUpdate(
        { slug: reg.eventSlug, registeredCount: { $gt: 0 } },
        { $inc: { registeredCount: -1 } },
      );
      eventsCancelled++;
    }

    // 2. Course enrollments: PENDING + createdAt < cutoff + no
    //    paymentConfirmed + no transactionReference.
    const staleEnrollments = await this.courseEnrollmentModel
      .find({
        status: "PENDING",
        createdAt: { $lt: cutoff },
        paymentConfirmed: { $ne: true },
        transactionReference: null,
      })
      .limit(500);

    let coursesCancelled = 0;
    for (const enr of staleEnrollments) {
      const cancelled = await this.courseEnrollmentModel.findOneAndUpdate(
        { _id: enr._id, status: "PENDING" },
        { status: "CANCELLED" },
        { new: true },
      );
      if (!cancelled) continue;
      await this.courseModel.findOneAndUpdate(
        { slug: enr.courseSlug, enrolledCount: { $gt: 0 } },
        { $inc: { enrolledCount: -1 } },
      );
      coursesCancelled++;
    }

    this.logger.log(
      `sweepStaleRegistrations: ${eventsCancelled} events, ${coursesCancelled} courses released`,
    );
    return { eventsCancelled, coursesCancelled };
  }
}
