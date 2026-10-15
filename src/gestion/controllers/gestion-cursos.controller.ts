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
  ForbiddenException,
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
  UserRole,
  UserSubrole,
} from "../../users/schemas/user.schema";
import { Course, CourseDocument } from "../../events/schemas/course.schema";
import {
  CourseEnrollment,
  CourseEnrollmentDocument,
} from "../../events/schemas/course-enrollment.schema";
import { ParseObjectIdPipe } from "../../common/pipes/parse-object-id.pipe";
import { parseCheckInInput } from "../../events/events-checkin.helpers";
import {
  IsNumber,
  Min,
  Max,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";

interface AuthenticatedGestionRequest extends Request {
  user: {
    userId: string;
    email: string;
    role: string;
    subrol?: string | null;
    contractorInfo?: {
      nombres: string;
      apellidos: string;
    } | null;
  };
}

class UpdateCourseProgressDto {
  @IsNumber()
  @Min(0)
  @Max(100)
  progress!: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  status?: string;
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

  private authorizeCourseCoordinator(
    course: CourseDocument | (Course & { _id: unknown }),
    user: AuthenticatedGestionRequest["user"],
  ): void {
    const isSuper =
      user.role === (UserRole.ADMIN as string) ||
      user.role === (UserRole.SUPERADMIN as string) ||
      (user.subrol as string | null) === (UserSubrole.LIDER_CURSOS as string);
    if (isSuper) return;

    if (!course.coordinatorId) {
      throw new BadRequestException(
        "Este curso aún no tiene un coordinador asignado por la Dirección en Console. Contacte a la Dirección.",
      );
    }

    if (String(course.coordinatorId) !== String(user.userId)) {
      const assignedName =
        course.coordinatorName || "el gestor asignado por la Dirección";
      throw new ForbiddenException(
        `Operación no autorizada: La validación de asistencia en campo o aula para este curso está asignada exclusivamente a ${assignedName}.`,
      );
    }
  }

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
    const filter: Record<string, unknown> = {};
    if (courseSlug) {
      filter.courseSlug = courseSlug;
    }

    const enrollments = await this.enrollmentModel
      .find(filter)
      .sort({ createdAt: -1 })
      .lean();

    const userIds = Array.from(
      new Set(enrollments.map((e) => e.userId).filter(Boolean)),
    );
    const users = await this.userModel
      .find({ _id: { $in: userIds } })
      .select("email profile contractorInfo")
      .lean();
    const userMap = new Map(users.map((u) => [String(u._id), u]));

    const enrichedEnrollments = enrollments.map((e) => {
      const u = userMap.get(String(e.userId));
      const rawProfile = u?.profile as
        Record<string, Record<string, string>> | undefined;
      const personal = rawProfile?.["datos-personales"];
      const contact = rawProfile?.["contacto"];
      const primerNombre =
        typeof personal?.primerNombre === "string" ? personal.primerNombre : "";
      const primerApellido =
        typeof personal?.primerApellido === "string"
          ? personal.primerApellido
          : "";
      const fullName = `${primerNombre} ${primerApellido}`.trim();
      const studentName = fullName || u?.email || "Estudiante BSKMT";

      return {
        ...e,
        userName: studentName,
        userEmail: u?.email,
        userPhone: typeof contact?.celular === "string" ? contact.celular : "",
      };
    });

    let course = null;
    if (courseSlug) {
      course = await this.courseModel
        .findOne({ slug: courseSlug })
        .select(
          "_id slug title level format date coordinatorId coordinatorName coordinatorEmail",
        )
        .lean();
    }

    return { course, enrollments: enrichedEnrollments };
  }

  @Post("scan-checkin")
  @HttpCode(HttpStatus.OK)
  async scanCheckIn(
    @Req() req: AuthenticatedGestionRequest,
    @Body() dto: { courseSlug?: string; codeOrQr: string },
  ) {
    if (!dto.codeOrQr || typeof dto.codeOrQr !== "string") {
      throw new BadRequestException("Código o lectura de QR requerida.");
    }

    const parsed = parseCheckInInput(dto.codeOrQr);
    const candidateCode = parsed.checkInCode;
    const candidateRegId = parsed.registrationId;

    const orClauses: Record<string, unknown>[] = [];
    if (candidateCode) {
      orClauses.push({ checkInCode: candidateCode });
    }
    if (candidateRegId && candidateRegId.match(/^[0-9a-fA-F]{24}$/)) {
      orClauses.push({ _id: candidateRegId });
    }
    if (candidateCode && candidateCode.match(/^[0-9a-fA-F]{24}$/)) {
      orClauses.push({ _id: candidateCode });
    }

    if (orClauses.length === 0) {
      throw new BadRequestException("Formato de código o QR no válido.");
    }

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

    // EXCLUSIVIDAD DE COORDINADOR ASIGNADO
    this.authorizeCourseCoordinator(course, req.user);

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
    const rawProfile = u?.profile as
      Record<string, Record<string, string>> | undefined;
    const personal = rawProfile?.["datos-personales"];
    const contact = rawProfile?.["contacto"];
    const primerNombre =
      typeof personal?.primerNombre === "string" ? personal.primerNombre : "";
    const primerApellido =
      typeof personal?.primerApellido === "string"
        ? personal.primerApellido
        : "";
    const studentName =
      `${primerNombre} ${primerApellido}`.trim() || u?.email || "Estudiante";

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
          name: studentName,
          email: u?.email,
          phone:
            typeof contact?.celular === "string"
              ? contact.celular
              : "No registrado",
          checkInCode: enrollment.checkInCode,
          attendedAt: enrollment.attendedAt,
          checkedInByName: enrollment.checkedInByName,
        },
        enrollment,
      };
    }

    const checkedByName = req.user.contractorInfo
      ? `${req.user.contractorInfo.nombres} ${req.user.contractorInfo.apellidos}`
      : req.user.email || req.user.userId;

    enrollment.attendanceConfirmed = true;
    enrollment.attendedAt = new Date();
    enrollment.checkedInBy = req.user.userId;
    enrollment.checkedInByName = checkedByName;
    if (enrollment.status === "PENDING") {
      enrollment.status = "ACTIVE";
    }
    await enrollment.save();

    return {
      success: true,
      alreadyCheckedIn: false,
      message: `¡Asistencia confirmada para ${studentName}!`,
      attendee: {
        name: studentName,
        email: u?.email,
        phone:
          typeof contact?.celular === "string"
            ? contact.celular
            : "No registrado",
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

    // EXCLUSIVIDAD DE COORDINADOR ASIGNADO
    this.authorizeCourseCoordinator(course, req.user);

    const checkedByName = req.user.contractorInfo
      ? `${req.user.contractorInfo.nombres} ${req.user.contractorInfo.apellidos}`
      : req.user.email || req.user.userId;

    enrollment.attendanceConfirmed = true;
    enrollment.attendedAt = new Date();
    enrollment.checkedInBy = req.user.userId;
    enrollment.checkedInByName = checkedByName;
    if (enrollment.status === "PENDING") {
      enrollment.status = "ACTIVE";
    }
    await enrollment.save();

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
