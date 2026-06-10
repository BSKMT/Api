import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document } from "mongoose";

export type CourseDocument = Course & Document;

export enum CourseLevel {
  PRINCIPIANTE = "principiante",
  INTERMEDIO = "intermedio",
  AVANZADO = "avanzado",
  TODOS = "todos",
}

export enum CourseFormat {
  VIRTUAL = "virtual",
  SEMIPRESENCIAL = "semipresencial",
  PRESENCIAL = "presencial",
}

export enum CourseStatus {
  DRAFT = "draft",
  PUBLISHED = "published",
  ARCHIVED = "archived",
}

@Schema({ timestamps: true })
export class Course {
  @Prop({ required: true, unique: true, index: true })
  slug: string;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  subtitle: string;

  @Prop({
    required: true,
    enum: Object.values(CourseLevel),
    default: CourseLevel.TODOS,
  })
  level: string;

  @Prop({
    required: true,
    enum: Object.values(CourseFormat),
    default: CourseFormat.VIRTUAL,
  })
  format: string;

  @Prop({ type: String, default: null })
  icon: string | null;

  @Prop({ type: String, default: null })
  description: string | null;

  @Prop({ type: String, default: null })
  heroImage: string | null;

  @Prop({ type: Number, default: null })
  durationHours: number | null;

  @Prop({ type: [String], default: [] })
  modules: string[];

  @Prop({ default: true })
  membersFree: boolean;

  @Prop({ type: Number, default: null })
  nonMemberPrice: number | null;

  @Prop({ type: Number, default: null })
  memberSemipresencialDiscount: number | null;

  @Prop({ type: Number, default: null })
  memberPresencialDiscount: number | null;

  @Prop({ type: Number, default: null })
  maxCapacity: number | null;

  @Prop({ type: Number, default: 0 })
  enrolledCount: number;

  @Prop({
    required: true,
    enum: Object.values(CourseStatus),
    default: CourseStatus.PUBLISHED,
  })
  status: string;

  @Prop({ default: false })
  featured: boolean;

  @Prop({ type: [String], default: [] })
  featuresIncluded: string[];

  @Prop({ type: Object, default: {} })
  metadata: Record<string, unknown>;
}

export const CourseSchema = SchemaFactory.createForClass(Course);

CourseSchema.index({ level: 1, status: 1 });
CourseSchema.index({ format: 1, status: 1 });
CourseSchema.index({ featured: 1, status: 1 });
