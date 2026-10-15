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
import {
  generateCheckInCode,
  buildQrTicketPayload,
} from "./events-checkin.helpers";
import { ConfigService } from "@nestjs/config";
import { User, UserDocument } from "../users/schemas/user.schema";
import { BirdEmailService } from "../bird/bird-email.service";
import { dispatchConfirmedCourseTicketNotification } from "./events-ticket-notification.helper";
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
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly notificationsService: NotificationsService,
    private readonly kvCache: KvCacheService,
    private readonly birdEmailService: BirdEmailService,
    private readonly configService: ConfigService,
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
    const result = await executeEnrollInCourse(
      this.courseModel,
      this.courseEnrollmentModel,
      userId,
      courseSlug,
      membershipLevel,
      this.logger,
    );

    if (
      result.enrollment.status === "ACTIVE" &&
      result.enrollment.paymentConfirmed
    ) {
      const course = await this.courseModel.findOne({ slug: courseSlug });
      if (course) {
        const panelUrl =
          this.configService.get<string>("PANEL_URL") ??
          "https://panel.bskmt.com";
        void dispatchConfirmedCourseTicketNotification(
          result.enrollment,
          course,
          this.userModel,
          this.birdEmailService,
          panelUrl,
          this.logger,
        );
      }
    }

    return result;
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
    const enrollment = await executeLinkCoursePayment(
      this.courseEnrollmentModel,
      userId,
      courseSlug,
      transactionReference,
      this.logger,
    );

    if (enrollment.paymentConfirmed) {
      const course = await this.courseModel.findOne({ slug: courseSlug });
      if (course) {
        const panelUrl =
          this.configService.get<string>("PANEL_URL") ??
          "https://panel.bskmt.com";
        void dispatchConfirmedCourseTicketNotification(
          enrollment,
          course,
          this.userModel,
          this.birdEmailService,
          panelUrl,
          this.logger,
        );
      }
    }

    return enrollment;
  }

  async getMyEnrollments(userId: string, includeCancelled = false) {
    const filter: Record<string, unknown> = { userId };
    if (!includeCancelled) {
      filter.status = { $ne: "CANCELLED" };
    }
    const enrollments = await this.courseEnrollmentModel
      .find(filter)
      .sort({ createdAt: -1 });
    for (const enr of enrollments) {
      if (!enr.checkInCode) {
        const code = generateCheckInCode("CRS");
        enr.checkInCode = code;
        enr.qrCodeData = buildQrTicketPayload("COURSE", {
          registrationId: String(enr._id),
          slug: enr.courseSlug,
          checkInCode: code,
          userId,
        });
        await enr.save();
      }
    }
    return enrollments;
  }

  async getEnrollmentByUserAndCourse(userId: string, courseSlug: string) {
    const enrollment = await this.courseEnrollmentModel.findOne({
      userId,
      courseSlug,
    });
    if (enrollment && !enrollment.checkInCode) {
      const code = generateCheckInCode("CRS");
      enrollment.checkInCode = code;
      enrollment.qrCodeData = buildQrTicketPayload("COURSE", {
        registrationId: String(enrollment._id),
        slug: courseSlug,
        checkInCode: code,
        userId,
      });
      await enrollment.save();
    }
    return enrollment;
  }
}
