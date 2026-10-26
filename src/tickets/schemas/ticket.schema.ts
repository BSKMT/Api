import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document, Schema as MongooseSchema } from "mongoose";

export type TicketDocument = Ticket & Document;

export enum TicketStatus {
  NUEVO = "nuevo",
  ABIERTO = "abierto",
  PENDIENTE = "pendiente",
  EN_PROGRESO = "en_progreso",
  RESUELTO = "resuelto",
  CERRADO = "cerrado",
}

export enum TicketPriority {
  BAJA = "baja",
  MEDIA = "media",
  ALTA = "alta",
  URGENTE = "urgente",
}

export enum TicketChannel {
  WEB_CONTACT = "web_contacto",
  PANEL = "panel_miembro",
  FASCIA = "fascia_operativa",
  WHATSAPP = "whatsapp",
  EMAIL = "email",
  SMS = "sms",
}

export enum TicketInteractionMode {
  BOT = "bot",
  LIVE_AGENT = "live_agent",
  CLOSED = "closed",
}

export enum TicketCategory {
  GENERAL = "general",
  MEMBRESIA = "membresia",
  EVENTOS = "eventos",
  CURSOS = "cursos",
  ARPHA = "arpha",
  TIENDA = "tienda",
  FACTURACION = "facturacion",
  HABEAS_DATA = "habeas_data",
}

export interface TicketCustomer {
  name: string;
  email: string;
  phone?: string | null;
  userId?: string | null;
  birdContactId?: string | null;
}

export interface TicketAssignee {
  userId: string;
  name: string;
  email: string;
}

export interface TicketMessage {
  messageId: string;
  sender: "customer" | "agent" | "system";
  senderName: string;
  senderEmail?: string | null;
  content: string;
  isInternalNote: boolean;
  createdAt: Date;
}

export interface TicketAudit {
  action: string;
  performedBy: string;
  details?: Record<string, unknown>;
  timestamp: Date;
}

export interface TicketSLA {
  firstResponseDue: Date;
  firstRespondedAt?: Date | null;
  resolutionDue: Date;
  resolvedAt?: Date | null;
  isSlaBreached: boolean;
}

@Schema({ timestamps: true, collection: "customer_tickets" })
export class Ticket {
  @Prop({ required: true, unique: true, index: true })
  ticketNumber!: string;

  @Prop({ required: true, trim: true })
  subject!: string;

  @Prop({ required: true })
  description!: string;

  @Prop({
    required: true,
    enum: Object.values(TicketCategory),
    default: TicketCategory.GENERAL,
    index: true,
  })
  category!: TicketCategory;

  @Prop({
    required: true,
    enum: Object.values(TicketPriority),
    default: TicketPriority.MEDIA,
    index: true,
  })
  priority!: TicketPriority;

  @Prop({
    required: true,
    enum: Object.values(TicketStatus),
    default: TicketStatus.NUEVO,
    index: true,
  })
  status!: TicketStatus;

  @Prop({
    required: true,
    enum: Object.values(TicketChannel),
    default: TicketChannel.WEB_CONTACT,
    index: true,
  })
  channel!: TicketChannel;

  @Prop({
    type: {
      name: { type: String, required: true },
      email: {
        type: String,
        required: true,
        lowercase: true,
        trim: true,
        index: true,
      },
      phone: { type: String, default: null },
      userId: { type: String, default: null, index: true },
      birdContactId: { type: String, default: null },
    },
    required: true,
    _id: false,
  })
  customer!: TicketCustomer;

  @Prop({
    type: {
      userId: { type: String, required: true },
      name: { type: String, required: true },
      email: { type: String, required: true },
    },
    default: null,
    _id: false,
  })
  assignedTo?: TicketAssignee | null;

  @Prop({
    type: [
      {
        messageId: { type: String, required: true },
        sender: {
          type: String,
          enum: ["customer", "agent", "system"],
          required: true,
        },
        senderName: { type: String, required: true },
        senderEmail: { type: String, default: null },
        content: { type: String, required: true },
        isInternalNote: { type: Boolean, default: false },
        createdAt: { type: Date, default: () => new Date() },
      },
    ],
    default: [],
  })
  messages!: TicketMessage[];

  @Prop({
    type: [
      {
        action: { type: String, required: true },
        performedBy: { type: String, required: true },
        details: { type: MongooseSchema.Types.Mixed, default: {} },
        timestamp: { type: Date, default: () => new Date() },
      },
    ],
    default: [],
  })
  auditLog!: TicketAudit[];

  @Prop({ type: [String], default: [], index: true })
  tags!: string[];

  @Prop({
    type: {
      firstResponseDue: { type: Date, required: true },
      firstRespondedAt: { type: Date, default: null },
      resolutionDue: { type: Date, required: true },
      resolvedAt: { type: Date, default: null },
      isSlaBreached: { type: Boolean, default: false },
    },
    required: true,
    _id: false,
  })
  sla!: TicketSLA;

  @Prop({
    required: false,
    enum: Object.values(TicketInteractionMode),
    default: TicketInteractionMode.LIVE_AGENT,
    index: true,
  })
  interactionMode?: TicketInteractionMode;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  metadata?: Record<string, unknown>;

  createdAt?: Date;
  updatedAt?: Date;
}

export const TicketSchema = SchemaFactory.createForClass(Ticket);

TicketSchema.index({ status: 1, priority: 1, createdAt: -1 });
TicketSchema.index({ "customer.email": 1, createdAt: -1 });
TicketSchema.index({ "assignedTo.userId": 1, status: 1 });
TicketSchema.index({ channel: 1, interactionMode: 1, updatedAt: -1 });
