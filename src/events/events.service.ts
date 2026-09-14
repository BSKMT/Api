import { Injectable, Logger } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { KvCacheService } from "../kv/kv-cache.service";
import {
  EventRegistration,
  EventRegistrationDocument,
} from "./schemas/event-registration.schema";
import { Event, EventDocument } from "./schemas/event.schema";
import { Course, CourseDocument } from "./schemas/course.schema";
import {
  CourseEnrollment,
  CourseEnrollmentDocument,
} from "./schemas/course-enrollment.schema";
import { RegisterEventDto } from "./dto/register-event.dto";
import { SubmitCompanionDto } from "./dto/submit-companion.dto";
import { NotificationsService } from "../notifications/notifications.service";
import { CoursesService } from "./courses.service";
import {
  executeRegisterForEvent,
  executeConfirmRegistration,
  executeAcceptWaiver,
  executeSubmitCompanionData,
  executeLinkPayment,
} from "./events-registration-actions.helpers";
import {
  queryUpcomingEvents,
  queryFeaturedEvents,
  queryEventBySlug,
  queryEventStats,
} from "./events-query.helpers";
import {
  executeCancelRegistration,
  executeSweepStaleRegistrations,
} from "./events-sweep.helpers";
export { MEMBER_LEVELS, type CoursePricing } from "./events.constants";
export type { CoursePricingInput } from "./events-course-pricing.helpers";

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
    private readonly coursesService: CoursesService,
  ) {}

  async registerForEvent(
    userId: string,
    dto: RegisterEventDto,
    membershipLevel: string | null,
  ): Promise<EventRegistrationDocument> {
    return executeRegisterForEvent(
      this.eventModel,
      this.eventRegistrationModel,
      userId,
      dto,
      membershipLevel,
      this.logger,
    );
  }

  async confirmRegistration(
    userId: string,
    eventSlug: string,
  ): Promise<EventRegistrationDocument> {
    return executeConfirmRegistration(
      this.eventModel,
      this.eventRegistrationModel,
      userId,
      eventSlug,
      this.logger,
    );
  }

  async acceptWaiver(
    userId: string,
    eventSlug: string,
    clientIp?: string,
  ): Promise<EventRegistrationDocument> {
    return executeAcceptWaiver(
      this.eventRegistrationModel,
      userId,
      eventSlug,
      clientIp,
      this.logger,
    );
  }

  async submitCompanionData(
    userId: string,
    eventSlug: string,
    dto: SubmitCompanionDto,
  ): Promise<EventRegistrationDocument> {
    return executeSubmitCompanionData(
      this.eventRegistrationModel,
      userId,
      eventSlug,
      dto,
      this.logger,
    );
  }

  async linkPayment(
    userId: string,
    eventSlug: string,
    transactionReference: string,
  ): Promise<EventRegistrationDocument> {
    return executeLinkPayment(
      this.eventModel,
      this.eventRegistrationModel,
      userId,
      eventSlug,
      transactionReference,
      this.logger,
    );
  }

  async getRegistration(userId: string, eventSlug: string) {
    return this.eventRegistrationModel.findOne({ userId, eventSlug });
  }

  async getRegistrationsByUser(userId: string) {
    return this.eventRegistrationModel.find({ userId }).sort({ createdAt: -1 });
  }

  async getUpcomingEvents(limit: number = 6) {
    return queryUpcomingEvents(this.eventModel, this.kvCache, limit);
  }

  async getFeaturedEvents(limit: number = 3) {
    return queryFeaturedEvents(this.eventModel, this.kvCache, limit);
  }

  async getEventBySlug(slug: string) {
    return queryEventBySlug(this.eventModel, this.kvCache, slug);
  }

  async getAvailableCourses(limit: number = 6) {
    return this.coursesService.getAvailableCourses(limit);
  }

  async getCourseBySlug(slug: string) {
    return this.coursesService.getCourseBySlug(slug);
  }

  async getEventStats() {
    return queryEventStats(this.eventModel, this.courseModel, this.kvCache);
  }

  async cancelRegistration(userId: string, eventSlug: string) {
    return executeCancelRegistration(
      this.eventModel,
      this.eventRegistrationModel,
      this.notificationsService,
      userId,
      eventSlug,
      this.logger,
    );
  }

  async enrollInCourse(
    userId: string,
    courseSlug: string,
    membershipLevel: string | null,
  ): Promise<{ enrollment: CourseEnrollmentDocument; pricing: CoursePricing }> {
    return this.coursesService.enrollInCourse(
      userId,
      courseSlug,
      membershipLevel,
    );
  }

  calculateCoursePricing(
    course: CoursePricingInput,
    membershipLevel: string | null,
  ): CoursePricing {
    return this.coursesService.calculateCoursePricing(course, membershipLevel);
  }

  async cancelCourseEnrollment(userId: string, courseSlug: string) {
    return this.coursesService.cancelCourseEnrollment(userId, courseSlug);
  }

  async updateCourseProgress(
    userId: string,
    courseSlug: string,
    progress: number,
  ) {
    return this.coursesService.updateCourseProgress(
      userId,
      courseSlug,
      progress,
    );
  }

  async linkCoursePayment(
    userId: string,
    courseSlug: string,
    transactionReference: string,
  ): Promise<CourseEnrollmentDocument> {
    return this.coursesService.linkCoursePayment(
      userId,
      courseSlug,
      transactionReference,
    );
  }

  async getMyEnrollments(userId: string, includeCancelled = false) {
    return this.coursesService.getMyEnrollments(userId, includeCancelled);
  }

  async getEnrollmentByUserAndCourse(userId: string, courseSlug: string) {
    return this.coursesService.getEnrollmentByUserAndCourse(userId, courseSlug);
  }

  async sweepStaleRegistrations(now: Date = new Date()) {
    return executeSweepStaleRegistrations(
      this.eventModel,
      this.eventRegistrationModel,
      this.courseModel,
      this.courseEnrollmentModel,
      now,
      this.logger,
    );
  }
}
