import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import type { Request } from "express";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { SessionGuard } from "../../auth/session.guard";
import { GestionGuard } from "../../common/guards/gestion.guard";
import { RequireSubroles } from "../../common/decorators/subroles.decorator";
import {
  User,
  UserDocument,
  UserSubrole,
} from "../../users/schemas/user.schema";
import { Course, CourseDocument } from "../../events/schemas/course.schema";
import {
  CourseEnrollment,
  CourseEnrollmentDocument,
} from "../../events/schemas/course-enrollment.schema";
import { ParseObjectIdPipe } from "../../common/pipes/parse-object-id.pipe";
import {
  buildCheckInOrClauses,
  deriveGestionAttendee,
} from "../services/gestion-checkin.helpers";
import {
  fetchEnrichedCourseRoster,
  applyCourseCheckIn,
  authorizeCourseCoordinator,
  UpdateCourseProgressDto,
  type GestionActor,
} from "../services/gestion-cursos.helpers";

interface AuthenticatedGestionRequest extends Request {
  user: GestionActor;
}

@Controller("gestion/cursos")
@UseGuards(SessionGuard, GestionGuard)
@RequireSubroles(
  UserSubrole.LIDER_CURSOS,
  UserSubrole.GESTOR_CURSOS,
  UserSubrole.GESTOR_CAMPO,
  UserSubrole.GESTOR_OFICINA,
)
export class GestionCursosController {
  constructor(
    @InjectModel(Course.name)
    private readonly courseModel: Model<CourseDocument>,
    @InjectModel(CourseEnrollment.name)
    private readonly enrollmentModel: Model<CourseEnrollmentDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {}

  @Get("courses")
  async listCourses() {
    const courses = await this.courseModel
      .find()
      .select(
        "_id slug title level format duration durationHours date endDate enrolledCount maxCapacity coordinatorId coordinatorName coordinatorEmail status",
      )
      .sort({ createdAt: -1 })
      .lean();
    return { courses };
  }

  @Get("roster")
  async listRoster(@Query("courseSlug") courseSlug?: string) {
    return fetchEnrichedCourseRoster(
      courseSlug,
      this.enrollmentModel,
      this.userModel,
      this.courseModel,
    );
  }

  @Post("scan-checkin")
  @HttpCode(HttpStatus.OK)
  async scanCheckIn(
    @Req() req: AuthenticatedGestionRequest,
    @Body() dto: { courseSlug?: string; codeOrQr: string },
  ) {
    const orClauses = buildCheckInOrClauses(dto.codeOrQr);
    const enrollment = await this.enrollmentModel.findOne({ $or: orClauses });
    if (!enrollment) {
      throw new NotFoundException(
        "No se encontró ninguna matrícula a curso con este código o QR.",
      );
    }

    const course = await this.courseModel.findOne({
      slug: enrollment.courseSlug,
    });
    if (!course) {
      throw new NotFoundException(
        "El curso asociado a esta matrícula no fue encontrado.",
      );
    }

    if (dto.courseSlug && course.slug !== dto.courseSlug) {
      throw new BadRequestException(
        `Este ticket pertenece al curso "${course.title}", no al curso seleccionado.`,
      );
    }

    authorizeCourseCoordinator(course, req.user);

    if (
      course.nonMemberPrice &&
      course.nonMemberPrice > 0 &&
      !enrollment.paymentConfirmed
    ) {
      throw new BadRequestException(
        "El pago de la matrícula de este estudiante se encuentra pendiente.",
      );
    }

    const u = await this.userModel
      .findById(enrollment.userId)
      .select("email profile contractorInfo")
      .lean();
    const attendee = deriveGestionAttendee(
      u as unknown as Record<string, unknown>,
      "Estudiante",
    );

    if (enrollment.attendanceConfirmed) {
      return {
        success: false,
        alreadyCheckedIn: true,
        message: `Asistencia ya confirmada previamente (${
          enrollment.attendedAt
            ? new Date(enrollment.attendedAt).toLocaleTimeString("es-CO", {
                hour: "2-digit",
                minute: "2-digit",
              })
            : "en campo"
        }).`,
        attendee: {
          name: attendee.name,
          email: attendee.email,
          phone: attendee.phone,
          checkInCode: enrollment.checkInCode,
          attendedAt: enrollment.attendedAt,
          checkedInByName: enrollment.checkedInByName,
        },
        enrollment,
      };
    }

    const checkedByName = await applyCourseCheckIn(enrollment, req.user);

    return {
      success: true,
      alreadyCheckedIn: false,
      message: `¡Asistencia confirmada para ${attendee.name}!`,
      attendee: {
        name: attendee.name,
        email: attendee.email,
        phone: attendee.phone,
        checkInCode: enrollment.checkInCode,
        attendedAt: enrollment.attendedAt,
        checkedInByName: checkedByName,
      },
      enrollment,
    };
  }

  @Post("check-in/:id")
  @Put("check-in/:id")
  @Patch("check-in/:id")
  @HttpCode(HttpStatus.OK)
  async checkIn(
    @Param("id", ParseObjectIdPipe) id: string,
    @Req() req: AuthenticatedGestionRequest,
  ) {
    const enrollment = await this.enrollmentModel.findById(id);
    if (!enrollment) {
      throw new NotFoundException("Matrícula a curso no encontrada");
    }

    const course = await this.courseModel.findOne({
      slug: enrollment.courseSlug,
    });
    if (!course) {
      throw new NotFoundException("Curso asociado no encontrado");
    }

    authorizeCourseCoordinator(course, req.user);
    await applyCourseCheckIn(enrollment, req.user);

    return {
      success: true,
      message: "Asistencia de alumno confirmada en campo.",
      enrollment,
    };
  }

  @Post("progress/:id")
  @Put("progress/:id")
  @Patch("progress/:id")
  @HttpCode(HttpStatus.OK)
  async updateProgress(
    @Param("id", ParseObjectIdPipe) id: string,
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
