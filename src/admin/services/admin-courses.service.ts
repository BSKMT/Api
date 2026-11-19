import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { KvCacheService } from "../../kv/kv-cache.service";
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
import { ensureString } from "../../common/utils/sanitize-query.util";
import { parsePositiveInt } from "../../common/utils/pagination.util";

@Injectable()
export class AdminCoursesService {
  private readonly logger = new Logger(AdminCoursesService.name);

  constructor(
    @InjectModel(Course.name)
    private readonly courseModel: Model<CourseDocument>,
    @InjectModel(CourseEnrollment.name)
    private readonly enrollmentModel: Model<CourseEnrollmentDocument>,
    private readonly kvCache: KvCacheService,
  ) {}

  private async invalidateCourseCache(slug?: string): Promise<void> {
    await this.kvCache.invalidatePrefix("courses:available:");
    if (slug) await this.kvCache.delete(`course:slug:${slug}`);
  }

  async listCourses(filters: {
    status?: string;
    level?: string;
    format?: string;
    limit?: number;
    page?: number;
  }) {
    const filter: Record<string, unknown> = {};
    const status = ensureString(filters.status);
    const level = ensureString(filters.level);
    const format = ensureString(filters.format);
    if (status) filter.status = status;
    if (level) filter.level = level;
    if (format) filter.format = format;

    const limit = parsePositiveInt(filters.limit, 50, 100);
    const page = parsePositiveInt(filters.page, 1, 10000);
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
      date: dto.date ? new Date(dto.date) : null,
      endDate: dto.endDate ? new Date(dto.endDate) : null,
      itinerary: dto.itinerary ?? [],
      status: dto.status ?? CourseStatus.DRAFT,
      enrolledCount: 0,
    });

    this.logger.log(`Course created: slug=${dto.slug} by admin`);
    await this.invalidateCourseCache();
    return created;
  }

  async updateCourse(
    slug: string,
    dto: UpdateCourseDto,
  ): Promise<CourseDocument> {
    const updateFields: Record<string, unknown> = { ...dto };
    delete updateFields.slug;
    if (dto.date) updateFields.date = new Date(dto.date);
    else if (dto.date === null || (dto.date as unknown) === "")
      updateFields.date = null;
    else if (dto.date === undefined) delete updateFields.date;

    if (dto.endDate) updateFields.endDate = new Date(dto.endDate);
    else if (dto.endDate === null || (dto.endDate as unknown) === "")
      updateFields.endDate = null;
    else if (dto.endDate === undefined) delete updateFields.endDate;

    if (dto.itinerary !== undefined) updateFields.itinerary = dto.itinerary;

    const updated = await this.courseModel.findOneAndUpdate(
      { slug },
      { $set: updateFields },
      { new: true },
    );
    if (!updated) {
      throw new NotFoundException("Curso no encontrado");
    }
    this.logger.log(`Course updated: slug=${slug}`);
    await this.invalidateCourseCache(slug);
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
    await this.invalidateCourseCache(slug);
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
    await this.invalidateCourseCache(slug);
    return course;
  }

  async listEnrollments(courseSlug: string, filters: { status?: string }) {
    const course = await this.courseModel.findOne({ slug: courseSlug }).lean();
    if (!course) {
      throw new NotFoundException("Curso no encontrado");
    }

    const filter: Record<string, unknown> = { courseSlug };
    const status = ensureString(filters.status);
    if (status) filter.status = status;

    const items = await this.enrollmentModel
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(500)
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
    // M-05: Atomic status transition prevents double-decrement of enrolledCount.
    const enrollment = await this.enrollmentModel.findOneAndUpdate(
      { _id: enrollmentId, status: { $ne: "CANCELLED" } },
      { $set: { status: "CANCELLED" } },
      { new: true },
    );
    if (!enrollment) {
      const existing = await this.enrollmentModel.findById(enrollmentId).lean();
      if (!existing) {
        throw new NotFoundException("Inscripción no encontrada");
      }
      throw new BadRequestException("La inscripción ya está cancelada");
    }

    await this.courseModel.updateOne(
      { slug: enrollment.courseSlug, enrolledCount: { $gt: 0 } },
      { $inc: { enrolledCount: -1 } },
    );

    this.logger.log(`Enrollment admin-cancelled: id=${enrollmentId}`);
    return enrollment;
  }
}
