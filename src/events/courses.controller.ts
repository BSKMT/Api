import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  BadRequestException,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import { Public } from "../common/decorators";
import { SessionGuard } from "../auth/session.guard";
import { UsersService } from "../users/users.service";
import { EventsService } from "./events.service";
import { EnrollCourseDto } from "./dto/enroll-course.dto";
import { CancelCourseDto } from "./dto/cancel-course.dto";
import { UpdateProgressDto } from "./dto/update-progress.dto";

interface AuthenticatedRequest extends Request {
  user: { userId: string; email?: string };
}

@Controller("courses")
export class CoursesController {
  constructor(
    private readonly eventsService: EventsService,
    private readonly usersService: UsersService,
  ) {}

  @Public()
  @Get("available")
  async getAvailableCourses(@Query("limit") limit?: string) {
    const parsedLimit = limit ? Number.parseInt(limit, 10) : 6;
    return this.eventsService.getAvailableCourses(parsedLimit);
  }

  @Public()
  @Get("detail/:slug")
  async getCourseBySlug(@Param("slug") slug: string) {
    const course = await this.eventsService.getCourseBySlug(slug);
    if (!course) {
      throw new BadRequestException("Curso no encontrado");
    }
    return course;
  }

  @UseGuards(SessionGuard)
  @Post("enroll")
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async enrollInCourse(
    @Req() req: AuthenticatedRequest,
    @Body() dto: EnrollCourseDto,
  ) {
    const { userId } = req.user;
    const fullUser = await this.usersService.findById(userId);
    const membershipLevel = fullUser?.membershipLevel ?? null;
    const result = await this.eventsService.enrollInCourse(
      userId,
      dto.courseSlug,
      membershipLevel,
    );
    return {
      enrollment: {
        status: result.enrollment.status,
        courseSlug: result.enrollment.courseSlug,
        progress: result.enrollment.progress,
        paymentConfirmed: result.enrollment.paymentConfirmed,
      },
      pricing: result.pricing,
    };
  }

  @UseGuards(SessionGuard)
  @Post("cancel")
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async cancelEnrollment(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CancelCourseDto,
  ) {
    const { userId } = req.user;
    return this.eventsService.cancelCourseEnrollment(userId, dto.courseSlug);
  }

  @UseGuards(SessionGuard)
  @Post("progress")
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  async updateProgress(
    @Req() req: AuthenticatedRequest,
    @Body() dto: UpdateProgressDto,
  ) {
    const { userId } = req.user;
    return this.eventsService.updateCourseProgress(
      userId,
      dto.courseSlug,
      dto.progress,
    );
  }

  @UseGuards(SessionGuard)
  @Get("my-enrollments")
  async getMyEnrollments(
    @Req() req: AuthenticatedRequest,
    @Query("all") all?: string,
  ) {
    const { userId } = req.user;
    const includeCancelled = all === "true" || all === "1";
    return this.eventsService.getMyEnrollments(userId, includeCancelled);
  }

  @UseGuards(SessionGuard)
  @Get("my-enrollment/:courseSlug")
  async getMyEnrollment(
    @Req() req: AuthenticatedRequest,
    @Param("courseSlug") courseSlug: string,
  ) {
    const { userId } = req.user;
    const fullUser = await this.usersService.findById(userId);
    const membershipLevel = fullUser?.membershipLevel ?? null;
    const course = await this.eventsService.getCourseBySlug(courseSlug);
    if (!course) {
      throw new BadRequestException("Curso no encontrado");
    }
    const pricing = this.eventsService.calculateCoursePricing(
      course,
      membershipLevel,
    );
    const enrollment = await this.eventsService.getEnrollmentByUserAndCourse(
      userId,
      courseSlug,
    );
    return { pricing, enrollment };
  }
}
