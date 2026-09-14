import { Schema as MongooseSchema } from "mongoose";

export interface FriendRequest {
  fromUserId: string;
  fromMemberNumber: string;
  fromDisplayName: string;
  message: string | null;
  status: "pending" | "accepted" | "declined";
  createdAt: Date;
}

export const FriendRequestSchema = new MongooseSchema(
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

export interface IdentityVerification {
  documentType: string;
  documentNumber: string;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  documentStatus: string | null;
  expirationDate: string | null;
  verifikId: string | null;
  verifiedAt: Date;
}

export const IdentityVerificationSchema = new MongooseSchema(
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

export enum UserSubrole {
  // ARPHA
  LIDER_ARPHA = "lider_arpha",
  GESTOR_CAMPO_ARPHA = "gestor_campo_arpha",
  GESTOR_MESA_ARPHA = "gestor_mesa_arpha",

  // EVENTOS
  LIDER_EVENTOS = "lider_eventos",
  GESTOR_EVENTOS = "gestor_eventos",

  // CURSOS
  LIDER_CURSOS = "lider_cursos",
  GESTOR_CURSOS = "gestor_cursos",

  // TIENDA
  LIDER_TIENDA = "lider_tienda",
  GESTOR_TIENDA = "gestor_tienda",

  // MEMBRESIAS
  LIDER_MEMBRESIAS = "lider_membresias",
  GESTOR_MEMBRESIAS = "gestor_membresias",
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

export const PartialPaymentCreditSchema = new MongooseSchema(
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

export const REQUIRED_PROFILE_SECTIONS = [
  "datos-personales",
  "contacto",
  "motocicleta",
  "salud-seguridad",
  "documentacion-legal",
  "experiencia-motera",
];
