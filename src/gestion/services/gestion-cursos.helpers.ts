import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { Model } from "mongoose";
import {
  IsNumber,
  Min,
  Max,
  IsOptional,
  IsString,
  IsIn,
} from "class-validator";
import type {
  Course,
  CourseDocument,
} from "../../events/schemas/course.schema";
import type { CourseEnrollmentDocument } from "../../events/schemas/course-enrollment.schema";
import {
  UserRole,
  UserSubrole,
  type UserDocument,
} from "../../users/schemas/user.schema";
import {
  deriveGestionAttendee,
  getGestionActorName,
} from "./gestion-checkin.helpers";

export interface GestionActor {
  userId: string;
  email: string;
  role: string;
  subrol?: string | null;
  contractorInfo?: {
    nombres: string;
    apellidos: string;
  } | null;
}

export class UpdateCourseProgressDto {
  @IsNumber()
  @Min(0)
  @Max(100)
  progress!: number;

  @IsOptional()
  @IsString()
  @IsIn(["ACTIVE", "COMPLETED", "CANCELLED"])
  status?: string;
}

export function authorizeCourseCoordinator(
  course: CourseDocument | (Course & { _id: unknown }),
  user: GestionActor,
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

export async function fetchEnrichedCourseRoster(
  courseSlug: string | undefined,
  enrollmentModel: Model<CourseEnrollmentDocument>,
  userModel: Model<UserDocument>,
  courseModel: Model<CourseDocument>,
) {
  const filter: Record<string, unknown> = {};
  if (courseSlug) {
    filter.courseSlug = courseSlug;
  }

  const enrollments = await enrollmentModel
    .find(filter)
    .sort({ createdAt: -1 })
    .lean();

  const userIds = Array.from(
    new Set(enrollments.map((e) => e.userId).filter(Boolean)),
  );
  const users = await userModel
    .find({ _id: { $in: userIds } })
    .select("email profile contractorInfo")
    .lean();
  const userMap = new Map(users.map((u) => [String(u._id), u]));

  const enrichedEnrollments = enrollments.map((e) => {
    const u = userMap.get(String(e.userId));
    const attendee = deriveGestionAttendee(
      u as unknown as Record<string, unknown>,
      "Estudiante BSKMT",
    );

    return {
      ...e,
      userName: attendee.name,
      userEmail: attendee.email,
      userPhone: attendee.phone,
    };
  });

  let course = null;
  if (courseSlug) {
    course = await courseModel
      .findOne({ slug: courseSlug })
      .select(
        "_id slug title level format date coordinatorId coordinatorName coordinatorEmail",
      )
      .lean();
  }

  return { course, enrollments: enrichedEnrollments };
}

export async function applyCourseCheckIn(
  enrollment: CourseEnrollmentDocument,
  user: GestionActor,
) {
  const checkedByName = getGestionActorName(user);

  enrollment.attendanceConfirmed = true;
  enrollment.attendedAt = new Date();
  enrollment.checkedInBy = user.userId;
  enrollment.checkedInByName = checkedByName;
  if (enrollment.status === "PENDING") {
    enrollment.status = "ACTIVE";
  }
  await enrollment.save();

  return checkedByName;
}
