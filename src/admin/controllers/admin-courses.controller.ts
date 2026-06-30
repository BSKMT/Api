import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { SessionGuard } from "../../auth/session.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles, Role } from "../../common/decorators";
import { AdminCoursesService } from "../services/admin-courses.service";
import { CreateCourseDto } from "../dto/create-course.dto";
import { UpdateCourseDto } from "../dto/update-course.dto";
import { CourseStatus } from "../../events/schemas/course.schema";

@Controller("admin/courses")
@UseGuards(SessionGuard, RolesGuard)
@Roles(Role.ADMIN, Role.EVENT_MANAGER)
export class AdminCoursesController {
  constructor(private readonly adminCoursesService: AdminCoursesService) {}

  @Get()
  async list(
    @Query("status") status?: string,
    @Query("level") level?: string,
    @Query("format") format?: string,
    @Query("limit") limit?: string,
    @Query("page") page?: string,
  ) {
    return this.adminCoursesService.listCourses({
      status,
      level,
      format,
      limit: limit ? parseInt(limit, 10) : 50,
      page: page ? parseInt(page, 10) : 1,
    });
  }

  @Get(":slug")
  async getOne(@Param("slug") slug: string) {
    return this.adminCoursesService.getCourse(slug);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateCourseDto) {
    return this.adminCoursesService.createCourse(dto);
  }

  @Put(":slug")
  async update(@Param("slug") slug: string, @Body() dto: UpdateCourseDto) {
    return this.adminCoursesService.updateCourse(slug, dto);
  }

  @Delete(":slug")
  async remove(@Param("slug") slug: string) {
    return this.adminCoursesService.deleteCourse(slug);
  }

  @Post(":slug/publish")
  @HttpCode(HttpStatus.OK)
  async publish(@Param("slug") slug: string) {
    return this.adminCoursesService.setStatus(slug, CourseStatus.PUBLISHED);
  }

  @Post(":slug/archive")
  @HttpCode(HttpStatus.OK)
  async archive(@Param("slug") slug: string) {
    return this.adminCoursesService.setStatus(slug, CourseStatus.ARCHIVED);
  }

  @Get(":slug/enrollments")
  async listEnrollments(
    @Param("slug") slug: string,
    @Query("status") status?: string,
  ) {
    return this.adminCoursesService.listEnrollments(slug, { status });
  }

  @Post("enrollments/:id/cancel")
  @HttpCode(HttpStatus.OK)
  async cancelEnrollment(@Param("id") id: string) {
    return this.adminCoursesService.adminCancelEnrollment(id);
  }
}
