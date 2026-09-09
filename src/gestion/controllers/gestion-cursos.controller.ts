import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { SessionGuard } from "../../auth/session.guard";
import { GestionGuard } from "../../common/guards/gestion.guard";
import { RequireSubroles } from "../../common/decorators/subroles.decorator";
import { UserSubrole } from "../../users/schemas/user.schema";
import { Course, CourseDocument } from "../../events/schemas/course.schema";
import {
  CourseEnrollment,
  CourseEnrollmentDocument,
} from "../../events/schemas/course-enrollment.schema";

class UpdateCourseProgressDto {
  progress!: number;
  status?: string;
}

@Controller("gestion/cursos")
@UseGuards(SessionGuard, GestionGuard)
@RequireSubroles(UserSubrole.LIDER_CURSOS, UserSubrole.GESTOR_CURSOS)
export class GestionCursosController {
  constructor(
    @InjectModel(Course.name)
    private readonly courseModel: Model<CourseDocument>,
    @InjectModel(CourseEnrollment.name)
    private readonly enrollmentModel: Model<CourseEnrollmentDocument>,
  ) {}

  @Get("courses")
  async listCourses() {
    const courses = await this.courseModel
      .find()
      .sort({ createdAt: -1 })
      .lean();
    return { courses };
  }

  @Get("roster")
  async listRoster(@Query("courseSlug") courseSlug?: string) {
    const filter: Record<string, unknown> = {};
    if (courseSlug) {
      filter.courseSlug = courseSlug;
    }

    const enrollments = await this.enrollmentModel
      .find(filter)
      .sort({ createdAt: -1 })
      .lean();

    return { enrollments };
  }

  @Post("progress/:id")
  @HttpCode(HttpStatus.OK)
  async updateProgress(
    @Param("id") id: string,
    @Body() dto: UpdateCourseProgressDto,
  ) {
    const enrollment = await this.enrollmentModel.findById(id);
    if (!enrollment) {
      throw new NotFoundException("Inscripción a curso no encontrada");
    }

    enrollment.progress = Math.min(Math.max(dto.progress, 0), 100);
    if (dto.status) {
      enrollment.status = dto.status;
    }
    if (enrollment.progress >= 100) {
      enrollment.status = "COMPLETED";
      enrollment.completedAt = new Date();
    }

    await enrollment.save();
    return {
      success: true,
      message: "Progreso del alumno actualizado",
      enrollment,
    };
  }
}
