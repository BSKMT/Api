import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document } from "mongoose";

export type EventDocument = Event & Document;

export enum EventCategory {
  RODADA = "rodada",
  RALLY = "rally",
  TALLER = "taller",
  GALA = "gala",
  TRACK_DAY = "track-day",
  ACADEMIA = "academia",
  EXCLUSIVO = "exclusivo",
}

export enum EventStatus {
  DRAFT = "draft",
  PUBLISHED = "published",
  CANCELLED = "cancelled",
  COMPLETED = "completed",
}

@Schema({ timestamps: true })
export class Event {
  @Prop({ required: true, unique: true, index: true })
  slug: string;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  subtitle: string;

  @Prop({ required: true })
  date: Date;

  @Prop({ type: Date, default: null })
  endDate: Date | null;

  @Prop({ required: true })
  location: string;

  @Prop({ type: String, default: null })
  meetingPoint: string | null;

  @Prop({ type: String, default: null })
  meetingTime: string | null;

  @Prop({ type: String, default: null })
  departureTime: string | null;

  @Prop({
    required: true,
    enum: Object.values(EventCategory),
    default: EventCategory.RODADA,
  })
  category: string;

  @Prop({ type: String, default: null })
  tag: string | null;

  @Prop({ type: String, default: null })
  icon: string | null;

  @Prop({ type: String, default: null })
  difficulty: string | null;

  @Prop({ type: String, default: null })
  duration: string | null;

  @Prop({ type: String, default: null })
  description: string | null;

  @Prop({ type: String, default: null })
  heroImage: string | null;

  @Prop({ type: String, default: null })
  heroImageAvif: string | null;

  @Prop({ default: true })
  membersFree: boolean;

  @Prop({ type: Number, default: null })
  nonMemberPrice: number | null;

  @Prop({ type: Number, default: null })
  companionPrice: number | null;

  @Prop({ type: Number, default: null })
  maxCapacity: number | null;

  @Prop({ type: Number, default: 0 })
  registeredCount: number;

  @Prop({
    required: true,
    enum: Object.values(EventStatus),
    default: EventStatus.PUBLISHED,
  })
  status: string;

  @Prop({ default: false })
  featured: boolean;

  @Prop({ type: [String], default: [] })
  featuresIncluded: string[];

  @Prop({ type: Object, default: {} })
  metadata: Record<string, unknown>;
}

export const EventSchema = SchemaFactory.createForClass(Event);

EventSchema.index({ date: 1, status: 1 });
EventSchema.index({ category: 1, status: 1 });
EventSchema.index({ featured: 1, status: 1 });
