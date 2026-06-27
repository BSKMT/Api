import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import {
  Course,
  CourseDocument,
  CourseStatus,
} from "../../events/schemas/course.schema";
import {
  CourseEnrollment,
  CourseEnrollmentDocument,
} from "../../events/schemas/course-enrollment.schema";
import { CreateCourseDto } from "../dto/create-course.dto";
import { UpdateCourseDto } from "../dto/update-course.dto";

@Injectable()
export class AdminCoursesService {
  private readonly logger = new Logger(AdminCoursesService.name);

  constructor(
    @InjectModel(Course.name)
    private courseModel: Model<CourseDocument>,
    @InjectModel(CourseEnrollment.name)
    private enrollmentModel: Model<CourseEnrollmentDocument>,
  ) {}

  async listCourses(filters: {
    status?: string;
    level?: string;
    format?: string;
    limit?: number;
    page?: number;
  }) {
    const filter: Record<string, unknown> = {};
    if (filters.status) filter.status = filters.status;
    if (filters.level) filter.level = filters.level;
    if (filters.format) filter.format = filters.format;

    const limit = filters.limit ?? 50;
    const page = filters.page ?? 1;
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.courseModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.courseModel.countDocuments(filter),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async getCourse(slug: string): Promise<CourseDocument> {
    const course = await this.courseModel.findOne({ slug }).lean();
    if (!course) {
      throw new NotFoundException("Curso no encontrado");
    }
    return course;
  }

  async createCourse(dto: CreateCourseDto): Promise<CourseDocument> {
    const existing = await this.courseModel.findOne({ slug: dto.slug });
    if (existing) {
      throw new ConflictException("Ya existe un curso con ese slug");
    }

    const created = await this.courseModel.create({
      ...dto,
      status: dto.status ?? CourseStatus.DRAFT,
      enrolledCount: 0,
    });

    this.logger.log(`Course created: slug=${dto.slug} by admin`);
    return created;
  }

  async updateCourse(
    slug: string,
    dto: UpdateCourseDto,
  ): Promise<CourseDocument> {
    const updated = await this.courseModel.findOneAndUpdate(
      { slug },
      { $set: { ...dto } },
      { new: true },
    );
    if (!updated) {
      throw new NotFoundException("Curso no encontrado");
    }
    this.logger.log(`Course updated: slug=${slug}`);
    return updated;
  }

  async deleteCourse(slug: string): Promise<{ message: string }> {
    const enrollmentsCount = await this.enrollmentModel.countDocuments({
      courseSlug: slug,
      status: { $ne: "CANCELLED" },
    });
    if (enrollmentsCount > 0) {
      throw new BadRequestException(
        `No se puede eliminar: existen ${enrollmentsCount} inscripciones activas. Usa archivar.`,
      );
    }

    const result = await this.courseModel.deleteOne({ slug });
    if (result.deletedCount === 0) {
      throw new NotFoundException("Curso no encontrado");
    }
    this.logger.log(`Course deleted: slug=${slug}`);
    return { message: "Curso eliminado exitosamente" };
  }

  async setStatus(slug: string, status: CourseStatus): Promise<CourseDocument> {
    const course = await this.courseModel.findOneAndUpdate(
      { slug },
      { $set: { status } },
      { new: true },
    );
    if (!course) {
      throw new NotFoundException("Curso no encontrado");
    }
    this.logger.log(`Course status set: slug=${slug} status=${status}`);
    return course;
  }

  async listEnrollments(courseSlug: string, filters: { status?: string }) {
    const course = await this.courseModel.findOne({ slug: courseSlug }).lean();
    if (!course) {
      throw new NotFoundException("Curso no encontrado");
    }

    const filter: Record<string, unknown> = { courseSlug };
    if (filters.status) filter.status = filters.status;

    const items = await this.enrollmentModel
      .find(filter)
      .sort({ createdAt: -1 })
      .lean();

    return {
      course: {
        slug: course.slug,
        title: course.title,
        enrolledCount: course.enrolledCount,
        maxCapacity: course.maxCapacity,
      },
      enrollments: items,
    };
  }

  async adminCancelEnrollment(enrollmentId: string) {
    const enrollment = await this.enrollmentModel.findById(enrollmentId);
    if (!enrollment) {
      throw new NotFoundException("Inscripción no encontrada");
    }
    if (enrollment.status === "CANCELLED") {
      throw new BadRequestException("La inscripción ya está cancelada");
    }
    enrollment.status = "CANCELLED";
    await enrollment.save();

    await this.courseModel.updateOne(
      { slug: enrollment.courseSlug },
      { $inc: { enrolledCount: -1 } },
    );

    this.logger.log(`Enrollment admin-cancelled: id=${enrollmentId}`);
    return enrollment;
  }
}
