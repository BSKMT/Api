import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document } from "mongoose";

export type CourseEnrollmentDocument = CourseEnrollment & Document;

@Schema({ timestamps: true })
export class CourseEnrollment {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true, index: true })
  courseSlug: string;

  @Prop({ required: true, default: "ACTIVE" })
  status: string;

  @Prop({ required: true, default: 0 })
  progress: number;

  @Prop({ default: false })
  paymentConfirmed: boolean;

  @Prop({ type: String, default: null })
  transactionReference: string | null;

  @Prop({ type: Date, default: null })
  completedAt: Date | null;

  @Prop({ type: String, default: null })
  certificateId: string | null;
}

export const CourseEnrollmentSchema =
  SchemaFactory.createForClass(CourseEnrollment);

CourseEnrollmentSchema.index({ userId: 1, courseSlug: 1 }, { unique: true });
