import {
  Injectable,
  Logger,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
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

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    @InjectModel(EventRegistration.name)
    private eventRegistrationModel: Model<EventRegistrationDocument>,
    @InjectModel(Event.name)
    private eventModel: Model<EventDocument>,
    @InjectModel(Course.name)
    private courseModel: Model<CourseDocument>,
    @InjectModel(CourseEnrollment.name)
    private courseEnrollmentModel: Model<CourseEnrollmentDocument>,
  ) {}

  async registerForEvent(
    userId: string,
    dto: RegisterEventDto,
    membershipLevel: string | null,
  ): Promise<EventRegistrationDocument> {
    const existing = await this.eventRegistrationModel.findOne({
      userId,
      eventSlug: dto.eventSlug,
    });

    if (existing) {
      throw new ConflictException("Ya estás registrado para este evento");
    }

    let membershipStatus: string;

    if (
      membershipLevel === "Legend" &&
      dto.registrationType === "professional"
    ) {
      membershipStatus = "active-member";
    } else if (
      dto.registrationType === "professional" &&
      membershipLevel !== "Legend"
    ) {
      membershipStatus = "non-member-paid";
    } else {
      membershipStatus = "non-member-free";
    }

    let status = "PENDING";

    if (membershipStatus === "active-member" && dto.attendanceMode === "solo") {
      status = "CONFIRMED";
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
    this.logger.log(
      `Event registration: user=${userId} event=${dto.eventSlug} status=${status}`,
    );
    return saved;
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

    const { membershipStatus, attendanceMode } = registration;

    if (membershipStatus === "active-member" && attendanceMode === "solo") {
      // no prerequisites
    } else if (
      membershipStatus === "active-member" &&
      attendanceMode === "with-companion"
    ) {
      if (!registration.paymentConfirmed) {
        throw new BadRequestException("Pago del acompañante pendiente");
      }
      if (!registration.companionData) {
        throw new BadRequestException("Datos del acompañante requeridos");
      }
    } else if (membershipStatus === "non-member-paid") {
      if (!registration.paymentConfirmed) {
        throw new BadRequestException("Pago pendiente");
      }
      if (attendanceMode === "with-companion" && !registration.companionData) {
        throw new BadRequestException("Datos del acompañante requeridos");
      }
    } else if (
      membershipStatus === "non-member-free" &&
      attendanceMode === "solo"
    ) {
      if (!registration.waiverAccepted) {
        throw new BadRequestException(
          "Debes aceptar la exoneración de responsabilidad",
        );
      }
    } else if (
      membershipStatus === "non-member-free" &&
      attendanceMode === "with-companion"
    ) {
      if (!registration.waiverAccepted) {
        throw new BadRequestException(
          "Debes aceptar la exoneración de responsabilidad",
        );
      }
      if (!registration.companionData) {
        throw new BadRequestException("Datos del acompañante requeridos");
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

  async acceptWaiver(
    userId: string,
    eventSlug: string,
  ): Promise<EventRegistrationDocument> {
    const registration = await this.eventRegistrationModel.findOneAndUpdate(
      { userId, eventSlug },
      { waiverAccepted: true, waiverAcceptedAt: new Date() },
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
    const registration = await this.eventRegistrationModel.findOneAndUpdate(
      { userId, eventSlug },
      { companionData: dto },
      { new: true },
    );

    if (!registration) {
      throw new NotFoundException("Registro no encontrado");
    }

    this.logger.log(
      `Companion data submitted: user=${userId} event=${eventSlug}`,
    );
    return registration;
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
    const now = new Date();
    return this.eventModel
      .find({
        status: EventStatus.PUBLISHED,
        date: { $gte: now },
      })
      .sort({ date: 1 })
      .limit(limit)
      .lean();
  }

  async getFeaturedEvents(limit: number = 3): Promise<EventDocument[]> {
    const now = new Date();
    return this.eventModel
      .find({
        status: EventStatus.PUBLISHED,
        featured: true,
        date: { $gte: now },
      })
      .sort({ date: 1 })
      .limit(limit)
      .lean();
  }

  async getEventBySlug(slug: string): Promise<EventDocument | null> {
    return this.eventModel
      .findOne({ slug, status: EventStatus.PUBLISHED })
      .lean();
  }

  async getAvailableCourses(limit: number = 6): Promise<CourseDocument[]> {
    return this.courseModel
      .find({ status: CourseStatus.PUBLISHED })
      .sort({ featured: -1, title: 1 })
      .limit(limit)
      .lean();
  }

  async getCourseBySlug(slug: string): Promise<CourseDocument | null> {
    return this.courseModel
      .findOne({ slug, status: CourseStatus.PUBLISHED })
      .lean();
  }

  async getEventStats() {
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

    return {
      totalEvents,
      upcomingEvents,
      totalCourses,
    };
  }

  async cancelRegistration(
    userId: string,
    eventSlug: string,
  ): Promise<{ message: string }> {
    const registration = await this.eventRegistrationModel.findOne({
      userId,
      eventSlug,
    });

    if (!registration) {
      throw new NotFoundException("Registro no encontrado");
    }

    if (registration.status === "CANCELLED") {
      throw new BadRequestException("El registro ya está cancelado");
    }

    registration.status = "CANCELLED";
    registration.confirmedAt = null;
    await registration.save();

    this.logger.log(
      `Registration cancelled: user=${userId} event=${eventSlug}`,
    );

    return { message: "Registro cancelado exitosamente" };
  }

  async enrollInCourse(
    userId: string,
    courseSlug: string,
    membershipLevel: string | null,
  ): Promise<CourseEnrollmentDocument> {
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

    if (existing) {
      throw new ConflictException("Ya estás inscrito en este curso");
    }

    const isMember =
      membershipLevel === "Legend" ||
      membershipLevel === "Friend" ||
      membershipLevel === "Rider" ||
      membershipLevel === "Expert" ||
      membershipLevel === "Master";

    const requiresPayment = !course.membersFree && !isMember;

    const enrollment = new this.courseEnrollmentModel({
      userId,
      courseSlug,
      status: requiresPayment ? "PENDING" : "ACTIVE",
      progress: 0,
      paymentConfirmed: !requiresPayment,
    });

    const saved = await enrollment.save();

    await this.courseModel.updateOne(
      { slug: courseSlug },
      { $inc: { enrolledCount: 1 } },
    );

    this.logger.log(
      `Course enrollment: user=${userId} course=${courseSlug} status=${enrollment.status}`,
    );

    return saved;
  }

  async cancelCourseEnrollment(
    userId: string,
    courseSlug: string,
  ): Promise<{ message: string }> {
    const enrollment = await this.courseEnrollmentModel.findOne({
      userId,
      courseSlug,
    });

    if (!enrollment) {
      throw new NotFoundException("Inscripción no encontrada");
    }

    if (enrollment.status === "CANCELLED") {
      throw new BadRequestException("La inscripción ya está cancelada");
    }

    enrollment.status = "CANCELLED";
    await enrollment.save();

    await this.courseModel.updateOne(
      { slug: courseSlug },
      { $inc: { enrolledCount: -1 } },
    );

    this.logger.log(
      `Course enrollment cancelled: user=${userId} course=${courseSlug}`,
    );

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

    enrollment.progress = Math.min(100, Math.max(0, progress));

    if (enrollment.progress === 100 && !enrollment.completedAt) {
      enrollment.status = "COMPLETED";
      enrollment.completedAt = new Date();
      enrollment.certificateId = `BSK-${courseSlug.toUpperCase().slice(0, 3)}-${Date.now().toString(36)}`;
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

  async getMyEnrollments(userId: string): Promise<CourseEnrollmentDocument[]> {
    return this.courseEnrollmentModel
      .find({ userId, status: { $ne: "CANCELLED" } })
      .sort({ createdAt: -1 });
  }
}
