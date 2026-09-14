import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document } from "mongoose";
import {
  FriendRequest,
  FriendRequestSchema,
  IdentityVerification,
  IdentityVerificationSchema,
  UserRole,
  UserSubrole,
  PartialPaymentCredit,
  PartialPaymentCreditSchema,
} from "./user-subdocuments.schema";

export type {
  FriendRequest,
  IdentityVerification,
  PartialPaymentCredit,
} from "./user-subdocuments.schema";
export {
  FriendRequestSchema,
  IdentityVerificationSchema,
  UserRole,
  UserSubrole,
  CreditType,
  PartialPaymentCreditSchema,
  REQUIRED_PROFILE_SECTIONS,
} from "./user-subdocuments.schema";

export type UserDocument = User & Document;

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

  @Prop({
    type: String,
    enum: [...Object.values(UserSubrole), null],
    default: null,
    index: true,
  })
  subrol?: string | null;

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
