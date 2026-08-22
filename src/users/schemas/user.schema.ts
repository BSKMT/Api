import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document, Schema as MongooseSchema } from "mongoose";

export interface FriendRequest {
  fromUserId: string;
  fromMemberNumber: string;
  fromDisplayName: string;
  message: string | null;
  status: "pending" | "accepted" | "declined";
  createdAt: Date;
}

const FriendRequestSchema = new MongooseSchema(
  {
    fromUserId: { type: String, required: true },
    fromMemberNumber: { type: String, required: true },
    fromDisplayName: { type: String, required: true },
    message: { type: String, default: null },
    status: {
      type: String,
      enum: ["pending", "accepted", "declined"],
      default: "pending",
    },
    createdAt: { type: Date, default: () => new Date() },
  },
  { _id: true },
);

export type UserDocument = User & Document;

/**
 * Official identity-verification record produced by the Verifik KYC
 * integration. Stored only after a successful match against the
 * official source (Registraduría for CC, Migración Colombia for
 * CE/PPT/PEP).
 *
 * Security notes (OWASP A04/A09:2025): this subdocument holds
 * government-verified personal data. It is written exclusively by
 * the server-side IdentityVerificationService — users can never PUT
 * it through the profile-section endpoint (the section id
 * "identity-verification" is not part of the section whitelist).
 */
export interface IdentityVerification {
  /** Verifik document type: CC | CE | PPT | PEP. */
  documentType: string;
  documentNumber: string;
  /** Official full name as returned by the registry. */
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  /** ISO date (YYYY-MM-DD) when provided by the source. */
  dateOfBirth: string | null;
  /** HOMBRE | MUJER | null. */
  gender: string | null;
  /** Immigration status for foreigner documents (e.g. VIGENTE). */
  documentStatus: string | null;
  /** Expiration date as returned by Verifik (DD/MM/YYYY). */
  expirationDate: string | null;
  /** Verifik request id for billing/support disputes. */
  verifikId: string | null;
  verifiedAt: Date;
}

const IdentityVerificationSchema = new MongooseSchema(
  {
    documentType: { type: String, required: true },
    documentNumber: { type: String, required: true },
    fullName: { type: String, required: true },
    firstName: { type: String, default: null },
    lastName: { type: String, default: null },
    dateOfBirth: { type: String, default: null },
    gender: { type: String, default: null },
    documentStatus: { type: String, default: null },
    expirationDate: { type: String, default: null },
    verifikId: { type: String, default: null },
    verifiedAt: { type: Date, required: true },
  },
  { _id: false },
);

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

  @Prop({ type: String, default: null })
  phone?: string | null;

  @Prop({ default: false })
  phoneVerified!: boolean;

  @Prop({ type: Date, default: null })
  phoneVerifiedAt?: Date | null;

  @Prop({ type: String, default: null })
  pendingPhone?: string | null;

  @Prop({ type: String, default: null })
  pendingEmail?: string | null;

  @Prop({ type: Object, default: {} })
  settings?: Record<string, unknown>;

  @Prop({ default: false })
  accountDeletionRequested!: boolean;

  @Prop({ type: Date, default: null })
  accountDeletionRequestedAt?: Date | null;

  @Prop({ type: [FriendRequestSchema], default: [] })
  friendRequests?: FriendRequest[];

  /**
   * KYC flag — true only after the user's identity was confirmed
   * against an official Colombian source via Verifik (see
   * IdentityVerification). Server-authoritative: never accepted from
   * client payloads.
   */
  @Prop({ default: false })
  identityVerified!: boolean;

  @Prop({ type: Date, default: null })
  identityVerifiedAt?: Date | null;

  @Prop({ type: IdentityVerificationSchema, default: null })
  identityVerification?: IdentityVerification | null;
}

export const UserSchema = SchemaFactory.createForClass(User);

export { REQUIRED_PROFILE_SECTIONS };
