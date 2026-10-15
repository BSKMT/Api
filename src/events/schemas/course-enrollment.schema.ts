import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document } from "mongoose";

export type CourseEnrollmentDocument = CourseEnrollment & Document;

@Schema({ timestamps: true })
export class CourseEnrollment {
  @Prop({ required: true, index: true })
  userId!: string;

  @Prop({ required: true, index: true })
  courseSlug!: string;

  @Prop({ required: true, default: "ACTIVE" })
  status!: string;

  @Prop({ required: true, default: 0 })
  progress!: number;

  @Prop({ default: false })
  paymentConfirmed!: boolean;

  @Prop({ type: String, default: null })
  transactionReference!: string | null;

  @Prop({ type: Date, default: null })
  completedAt!: Date | null;

  @Prop({ type: String, default: null })
  certificateId!: string | null;

  @Prop({ type: String, default: null, index: true, sparse: true })
  checkInCode?: string | null;

  @Prop({ type: String, default: null })
  qrCodeData?: string | null;

  @Prop({ default: false, index: true })
  attendanceConfirmed!: boolean;

  @Prop({ type: Date, default: null })
  attendedAt!: Date | null;

  @Prop({ type: String, default: null })
  checkedInBy?: string | null;

  @Prop({ type: String, default: null })
  checkedInByName?: string | null;

  @Prop({ default: false })
  confirmationEmailSent?: boolean;

  @Prop({ type: Date, default: null })
  confirmationEmailSentAt?: Date | null;

  createdAt!: Date;

  updatedAt!: Date;
}

export const CourseEnrollmentSchema =
  SchemaFactory.createForClass(CourseEnrollment);

CourseEnrollmentSchema.index({ userId: 1, courseSlug: 1 }, { unique: true });
CourseEnrollmentSchema.index({ courseSlug: 1, attendanceConfirmed: 1 });
