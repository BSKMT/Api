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
  ContractorInfo,
} from "./user-subdocuments.schema";
import {
  encryptSensitiveField,
  encryptUserProfileSensitiveFields,
  decryptUserProfileSensitiveFields,
} from "../../common/crypto/field-encryption.helper";

export type {
  FriendRequest,
  IdentityVerification,
  PartialPaymentCredit,
  ContractorInfo,
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
  createdAt?: Date;
  updatedAt?: Date;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email!: string;

  /**
   * Internal BSKMT unique username (e.g. bskmt5404jaci1849204).
   * Used for collaborators in Fascia, administrators in Console, and superadmins in New-BSKMT.
   */
  @Prop({
    type: String,
    unique: true,
    sparse: true,
    lowercase: true,
    trim: true,
    index: true,
  })
  username?: string | null;

  @Prop({ type: String, default: null })
  internalCode?: string | null;

  @Prop({ type: Object, default: null })
  contractorInfo?: ContractorInfo | null;

  @Prop({ type: [String], default: [] })
  adminPermissions?: string[];

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

  /** Identificador de contacto en Bird CRM (`con_...`). */
  @Prop({ type: String, default: null, sparse: true, index: true })
  birdContactId?: string | null;
}
export const UserSchema = SchemaFactory.createForClass(User);

// NIST CSF 2.0 ID.AM-07: Atomic uniqueness of officially verified KYC document numbers
UserSchema.index(
  { "identityVerification.documentNumber": 1 },
  {
    unique: true,
    partialFilterExpression: {
      identityVerified: true,
      "identityVerification.documentNumber": { $type: "string", $gt: "" },
    },
  },
);

// NIST CSF 2.0 PR.DS-01: Transparent Field-Level Encryption at Rest
export function decryptSensitiveProfileFields(doc: unknown): void {
  if (!doc || typeof doc !== "object") return;
  const record = doc as { profile?: unknown };
  if (record.profile && typeof record.profile === "object") {
    decryptUserProfileSensitiveFields(record.profile);
  }
}

UserSchema.post("init", (doc) => decryptSensitiveProfileFields(doc));
UserSchema.pre("save", function () {
  if (this.profile) encryptUserProfileSensitiveFields(this.profile);
});
UserSchema.post("save", (doc) => decryptSensitiveProfileFields(doc));
UserSchema.post("find", (docs: unknown[]) => {
  if (Array.isArray(docs)) {
    for (const doc of docs) decryptSensitiveProfileFields(doc);
  }
});
UserSchema.post("findOne", (doc: unknown) =>
  decryptSensitiveProfileFields(doc),
);
function encryptUpdatePayload(update: Record<string, unknown> | null): void {
  if (!update || Array.isArray(update)) return;
  if (update.profile && typeof update.profile === "object") {
    encryptUserProfileSensitiveFields(update.profile);
  }
  for (const dotKey of [
    "profile.salud-seguridad",
    "profile.documentacion-legal",
  ]) {
    if (update[dotKey] !== undefined && update[dotKey] !== null) {
      update[dotKey] = encryptSensitiveField(update[dotKey]);
    }
  }
  const setObj = update.$set as Record<string, unknown> | undefined;
  if (setObj && typeof setObj === "object") {
    if (setObj.profile && typeof setObj.profile === "object") {
      encryptUserProfileSensitiveFields(setObj.profile);
    }
    for (const dotKey of [
      "profile.salud-seguridad",
      "profile.documentacion-legal",
    ]) {
      if (setObj[dotKey] !== undefined && setObj[dotKey] !== null) {
        setObj[dotKey] = encryptSensitiveField(setObj[dotKey]);
      }
    }
  }
}

UserSchema.pre("findOneAndUpdate", function () {
  encryptUpdatePayload(this.getUpdate() as Record<string, unknown> | null);
});
UserSchema.pre("updateOne", function () {
  encryptUpdatePayload(this.getUpdate() as Record<string, unknown> | null);
});
UserSchema.pre("updateMany", function () {
  encryptUpdatePayload(this.getUpdate() as Record<string, unknown> | null);
});
UserSchema.post("findOneAndUpdate", (doc: unknown) =>
  decryptSensitiveProfileFields(doc),
);

UserSchema.set("toJSON", {
  transform: (_doc, ret) => {
    const obj = ret as unknown as Record<string, unknown>;
    delete obj["betterAuthId"];
    delete obj["pendingPhone"];
    delete obj["pendingEmail"];
    if (
      obj["identityVerification"] &&
      typeof obj["identityVerification"] === "object"
    ) {
      const iv = {
        ...(obj["identityVerification"] as Record<string, unknown>),
      };
      delete iv["verifikId"];
      obj["identityVerification"] = iv;
    }
    if (obj["profile"] && typeof obj["profile"] === "object") {
      decryptUserProfileSensitiveFields(obj["profile"]);
    }
    return obj;
  },
});
