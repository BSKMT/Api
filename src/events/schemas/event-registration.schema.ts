import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document } from "mongoose";

export type EventRegistrationDocument = EventRegistration & Document;

@Schema({ timestamps: true })
export class EventRegistration {
  @Prop({ required: true, index: true })
  userId!: string;

  @Prop({ required: true, index: true })
  eventSlug!: string;

  @Prop({ required: true })
  registrationType!: string;

  @Prop({ required: true })
  attendanceMode!: string;

  @Prop({ required: true, default: "PENDING" })
  status!: string;

  @Prop({ required: true })
  membershipStatus!: string;

  @Prop({ type: String, default: null })
  transactionReference!: string | null;

  @Prop({ default: false })
  paymentConfirmed!: boolean;

  @Prop({ default: false })
  waiverAccepted!: boolean;

  @Prop({ type: Date, default: null })
  waiverAcceptedAt!: Date | null;

  // EVT-17: Store IP/UA for waiver audit trail
  @Prop({ type: String, default: null })
  waiverAcceptedIp!: string | null;

  @Prop({
    type: Object,
    default: null,
  })
  companionData!: {
    fullName: string;
    documentId: string;
    phone: string;
    email: string;
    relationship?: string;
  } | null;

  @Prop({ type: Date, default: null })
  confirmedAt!: Date | null;

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
}

export const EventRegistrationSchema =
  SchemaFactory.createForClass(EventRegistration);

EventRegistrationSchema.index({ userId: 1, eventSlug: 1 }, { unique: true });
EventRegistrationSchema.index({ eventSlug: 1, attendanceConfirmed: 1 });
