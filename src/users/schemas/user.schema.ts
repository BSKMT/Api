import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document, Schema as MongooseSchema } from "mongoose";

export type UserDocument = User & Document;

export enum UserRole {
  USER = "user",
  MEMBER = "member",
  ADMIN = "admin",
  ROAD_CAPTAIN = "road-captain",
  EVENT_MANAGER = "event-manager",
  MODERATOR = "moderator",
}

export enum CreditType {
  PENDING = "pending",
  MEMBERSHIP = "membership",
  SERVICES = "services",
  REFUND_REQUESTED = "refund-requested",
  REFUNDED = "refunded",
}

export interface PartialPaymentCredit {
  amount: number;
  installmentsPaid: number;
  originalCurrency: string;
  createdAt: Date;
  type: CreditType;
  usedAmount: number;
  expiresAt: Date | null;
  refundRequestedAt: Date | null;
  convertedAt: Date | null;
  notes: string | null;
}

const PartialPaymentCreditSchema = new MongooseSchema(
  {
    amount: { type: Number, default: 0 },
    installmentsPaid: { type: Number, default: 0 },
    originalCurrency: { type: String, default: "COP" },
    createdAt: { type: Date, default: null },
    type: {
      type: String,
      enum: Object.values(CreditType),
      default: null,
    },
    usedAmount: { type: Number, default: 0 },
    expiresAt: { type: Date, default: null },
    refundRequestedAt: { type: Date, default: null },
    convertedAt: { type: Date, default: null },
    notes: { type: String, default: null },
  },
  { _id: false },
);

const REQUIRED_PROFILE_SECTIONS = [
  "datos-personales",
  "contacto",
  "motocicleta",
  "salud-seguridad",
  "documentacion-legal",
  "experiencia-motera",
];

@Schema({
  timestamps: true,
  collection: "users",
})
export class User {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email!: string;

  /**
   * Reference to the Better Auth `user` collection document.
   * Better Auth manages authentication (password, sessions, email verification);
   * this Mongoose collection stores business data only.
   */
  @Prop({ required: true, unique: true, index: true })
  betterAuthId!: string;

  @Prop({ type: String })
  membershipLevel?: string | null;

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

  @Prop({ type: Object, default: {} })
  profile!: Record<string, Record<string, unknown>>;

  @Prop({ default: [] })
  completedSections!: string[];

  @Prop({ type: Date })
  membershipStartDate?: Date | null;

  @Prop({ type: Date })
  membershipExpiryDate?: Date | null;

  @Prop({
    type: String,
    enum: ["single", "installments"],
  })
  membershipPaymentPlan?: string | null;

  @Prop({ default: 0 })
  installmentsPaid!: number;

  @Prop({ default: 12 })
  installmentsTotal!: number;

  @Prop({ default: 0 })
  renewalInstallmentsPaid!: number;

  @Prop({ type: Date })
  membershipGracePeriodEnd?: Date | null;

  @Prop({ default: false })
  membershipExpired!: boolean;

  @Prop({
    type: PartialPaymentCreditSchema,
    default: null,
  })
  partialPaymentCredit?: PartialPaymentCredit | null;
}

export const UserSchema = SchemaFactory.createForClass(User);

export { REQUIRED_PROFILE_SECTIONS };
