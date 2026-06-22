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
import type { Request } from "express";
import { Public } from "../common/decorators";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { UsersService } from "../users/users.service";
import { EventsService } from "./events.service";

@Controller("courses")
@UseGuards()
export class CoursesController {
  constructor(
    private readonly eventsService: EventsService,
    private readonly usersService: UsersService,
  ) {}

  @Public()
  @Get("available")
  async getAvailableCourses(@Query("limit") limit?: string) {
    const parsedLimit = limit ? parseInt(limit, 10) : 6;
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

  @UseGuards(JwtAuthGuard)
  @Post("enroll")
  async enrollInCourse(
    @Req() req: Request,
    @Body("courseSlug") courseSlug: string,
  ) {
    const user = req.user as { userId: string };
    const fullUser = await this.usersService.findById(user.userId);
    const membershipLevel = fullUser?.membershipLevel ?? null;
    return this.eventsService.enrollInCourse(
      user.userId,
      courseSlug,
      membershipLevel,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post("cancel")
  async cancelEnrollment(
    @Req() req: Request,
    @Body("courseSlug") courseSlug: string,
  ) {
    const user = req.user as { userId: string };
    return this.eventsService.cancelCourseEnrollment(user.userId, courseSlug);
  }

  @UseGuards(JwtAuthGuard)
  @Post("progress")
  async updateProgress(
    @Req() req: Request,
    @Body("courseSlug") courseSlug: string,
    @Body("progress") progress: number,
  ) {
    const user = req.user as { userId: string };
    return this.eventsService.updateCourseProgress(
      user.userId,
      courseSlug,
      Number(progress),
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get("my-enrollments")
  async getMyEnrollments(@Req() req: Request) {
    const user = req.user as { userId: string };
    return this.eventsService.getMyEnrollments(user.userId);
  }
}
