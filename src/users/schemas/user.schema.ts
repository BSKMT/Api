import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document } from "mongoose";

export type UserDocument = User & Document;

export enum UserRole {
  USER = "user",
  MEMBER = "member",
  ADMIN = "admin",
  ROAD_CAPTAIN = "road-captain",
  EVENT_MANAGER = "event-manager",
  MODERATOR = "moderator",
}

const REQUIRED_PROFILE_SECTIONS = [
  "datos-personales",
  "contacto",
  "motocicleta",
  "salud-seguridad",
  "documentacion-legal",
  "membresia-ecosistema",
  "experiencia-motera",
];

@Schema({
  timestamps: true,
  collection: "users",
})
export class User {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email!: string;

  @Prop({ required: true })
  password!: string;

  @Prop({ type: String, default: null })
  membershipLevel!: string | null;

  @Prop({
    type: String,
    enum: Object.values(UserRole),
    default: UserRole.USER,
  })
  role!: string;

  @Prop({ default: false })
  profileCompleted!: boolean;

  @Prop({ default: false })
  emailVerified!: boolean;

  @Prop({ default: false })
  legalConsentAccepted!: boolean;

  @Prop({ default: true })
  isActive!: boolean;

  @Prop()
  refreshTokenHash?: string;

  @Prop({ type: Object, default: {} })
  profile!: Record<string, Record<string, unknown>>;

  @Prop({ default: [] })
  completedSections!: string[];

  @Prop({ type: Date, default: null })
  membershipStartDate!: Date | null;

  @Prop({ type: Date, default: null })
  membershipExpiryDate!: Date | null;

  @Prop({
    type: String,
    enum: ["single", "installments", null],
    default: null,
  })
  membershipPaymentPlan!: string | null;

  @Prop({ default: 0 })
  installmentsPaid!: number;

  @Prop({ default: 12 })
  installmentsTotal!: number;

  @Prop({ default: 0 })
  renewalInstallmentsPaid!: number;

  @Prop({ type: Date, default: null })
  membershipGracePeriodEnd!: Date | null;

  @Prop({ default: false })
  membershipExpired!: boolean;
}

export const UserSchema = SchemaFactory.createForClass(User);

export { REQUIRED_PROFILE_SECTIONS };
