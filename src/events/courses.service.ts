import { Injectable, Logger } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { KvCacheService } from "../kv/kv-cache.service";
import { Course, CourseDocument } from "./schemas/course.schema";
import {
  CourseEnrollment,
  CourseEnrollmentDocument,
} from "./schemas/course-enrollment.schema";
import { NotificationsService } from "../notifications/notifications.service";
import {
  calculateCoursePricing,
  executeEnrollInCourse,
  executeLinkCoursePayment,
} from "./events-course.helpers";
import {
  executeCourseProgress,
  executeCancelCourseEnrollment,
} from "./events-course-progress.helpers";
import {
  queryAvailableCourses,
  queryCourseBySlug,
} from "./events-query.helpers";
import type { CoursePricing } from "./events.constants";
import type { CoursePricingInput } from "./events-course-pricing.helpers";

@Injectable()
export class CoursesService {
  private readonly logger = new Logger(CoursesService.name);

  constructor(
    @InjectModel(Course.name)
    private readonly courseModel: Model<CourseDocument>,
    @InjectModel(CourseEnrollment.name)
    private readonly courseEnrollmentModel: Model<CourseEnrollmentDocument>,
    private readonly notificationsService: NotificationsService,
    private readonly kvCache: KvCacheService,
  ) {}

  async getAvailableCourses(limit = 6) {
    return queryAvailableCourses(this.courseModel, this.kvCache, limit);
  }

  async getCourseBySlug(slug: string) {
    return queryCourseBySlug(this.courseModel, this.kvCache, slug);
  }

  async enrollInCourse(
    userId: string,
    courseSlug: string,
    membershipLevel: string | null,
  ): Promise<{ enrollment: CourseEnrollmentDocument; pricing: CoursePricing }> {
    return executeEnrollInCourse(
      this.courseModel,
      this.courseEnrollmentModel,
      userId,
      courseSlug,
      membershipLevel,
      this.logger,
    );
  }

  calculateCoursePricing(
    course: CoursePricingInput,
    membershipLevel: string | null,
  ): CoursePricing {
    return calculateCoursePricing(course, membershipLevel);
  }

  async cancelCourseEnrollment(userId: string, courseSlug: string) {
    return executeCancelCourseEnrollment(
      this.courseModel,
      this.courseEnrollmentModel,
      this.notificationsService,
      userId,
      courseSlug,
      this.logger,
    );
  }

  async updateCourseProgress(
    userId: string,
    courseSlug: string,
    progress: number,
  ) {
    return executeCourseProgress(
      this.courseEnrollmentModel,
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
    return executeLinkCoursePayment(
      this.courseEnrollmentModel,
      userId,
      courseSlug,
      transactionReference,
      this.logger,
    );
  }

  async getMyEnrollments(userId: string, includeCancelled = false) {
    const filter: Record<string, unknown> = { userId };
    if (!includeCancelled) {
      filter.status = { $ne: "CANCELLED" };
    }
    return this.courseEnrollmentModel.find(filter).sort({ createdAt: -1 });
  }

  async getEnrollmentByUserAndCourse(userId: string, courseSlug: string) {
    return this.courseEnrollmentModel.findOne({ userId, courseSlug });
  }
}
