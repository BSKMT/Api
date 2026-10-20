import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument } from "mongoose";

export enum AuditSeverity {
  INFO = "INFO",
  WARN = "WARN",
  ERROR = "ERROR",
  CRITICAL = "CRITICAL",
}

export type SecurityAuditLogDocument = HydratedDocument<SecurityAuditLog>;

/**
 * Esquema de Registro de Auditoría de Seguridad Inmutable.
 * Satisface NIST CSF 2.0 RS.AN-03, RS.AN-06 y RS.AN-07.
 *
 * Persiste metadatos forenses de eventos e incidentes de seguridad con
 * firma criptográfica HMAC y bloqueo a nivel de middleware Mongoose
 * para garantizar integridad y procedencia no repudiable.
 */
@Schema({
  timestamps: true,
  collection: "security_audit_logs",
})
export class SecurityAuditLog {
  @Prop({ type: String, required: true, index: true })
  requestId!: string;

  @Prop({ type: String, required: true, index: true })
  eventType!: string;

  @Prop({
    type: String,
    enum: Object.values(AuditSeverity),
    default: AuditSeverity.INFO,
    index: true,
  })
  severity!: AuditSeverity;

  @Prop({ type: Date, default: () => new Date(), index: true })
  timestamp!: Date;

  @Prop({ type: String, default: null, index: true })
  userId?: string | null;

  @Prop({ type: String, required: true })
  clientIp!: string;

  @Prop({ type: String, default: null })
  userAgent?: string | null;

  @Prop({ type: String, required: true })
  method!: string;

  @Prop({ type: String, required: true })
  path!: string;

  @Prop({ type: Number, required: true })
  statusCode!: number;

  @Prop({ type: Object, default: {} })
  details?: Record<string, unknown>;

  @Prop({ type: String, required: true })
  signature!: string;
}

export const SecurityAuditLogSchema =
  SchemaFactory.createForClass(SecurityAuditLog);

SecurityAuditLogSchema.index(
  { timestamp: 1 },
  { expireAfterSeconds: 15552000 },
); // Retención de 180 días

// Enforce inmutabilidad (RS.AN-06): Bloquear mutaciones sobre registros existentes
SecurityAuditLogSchema.pre(
  ["updateOne", "updateMany", "findOneAndUpdate"],
  function () {
    throw new Error(
      "Violación de integridad: los registros de auditoría de seguridad son inmutables (RS.AN-06).",
    );
  },
);
