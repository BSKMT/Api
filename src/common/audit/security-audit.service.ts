import { Injectable, Logger, Optional } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { createHmac } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import {
  SecurityAuditLog,
  SecurityAuditLogDocument,
  AuditSeverity,
} from "./schemas/security-audit-log.schema";
import type { EnvironmentConfig } from "../../config/config.interface";
import { BirdSmsService } from "../../bird/bird-sms.service";

export { AuditSeverity };

export interface RecordAuditEventParams {
  requestId: string;
  eventType: string;
  severity: AuditSeverity;
  clientIp: string;
  method: string;
  path: string;
  statusCode: number;
  userId?: string | null;
  userAgent?: string | null;
  details?: Record<string, unknown>;
}

/**
 * Servicio de Auditoría de Seguridad Inmutable y Notificación de Incidentes.
 * Satisface NIST CSF 2.0 RS.AN-03, RS.AN-06, RS.AN-07 y RS.CO-02.
 */
@Injectable()
export class SecurityAuditService {
  private readonly logger = new Logger(SecurityAuditService.name);
  private readonly hmacKey: Buffer;
  private readonly alertPhone?: string;
  private readonly smsCooldownByEvent = new Map<string, number>();
  private static readonly SMS_COOLDOWN_MS = 60_000;

  constructor(
    @InjectModel(SecurityAuditLog.name)
    private readonly auditModel: Model<SecurityAuditLogDocument>,
    private readonly configService: ConfigService<EnvironmentConfig>,
    @Optional()
    private readonly birdSmsService?: BirdSmsService,
  ) {
    const configuredSecret =
      this.configService.get<string>("BETTER_AUTH_SECRET", { infer: true }) ||
      process.env.BETTER_AUTH_SECRET;
    if (!configuredSecret && process.env.NODE_ENV === "production") {
      throw new Error(
        "BETTER_AUTH_SECRET is required in production for SecurityAuditService",
      );
    }
    const baseSecret = configuredSecret || `dev-test-audit-${process.pid}`;
    // Domain-separated HMAC key derived specifically for immutable audit signatures
    this.hmacKey = createHmac("sha256", baseSecret)
      .update("bskmt:security-audit:hmac-v2")
      .digest();
    this.alertPhone =
      this.configService.get<string>("SECDEVOPS_ALERT_PHONE", {
        infer: true,
      }) ??
      this.configService.get<string>("SECURITY_ALERT_PHONE", {
        infer: true,
      }) ??
      process.env.SECDEVOPS_ALERT_PHONE ??
      process.env.SECURITY_ALERT_PHONE;
  }

  private generateSignature(
    data: RecordAuditEventParams,
    timestamp: Date,
  ): string {
    const payload = JSON.stringify({
      requestId: data.requestId,
      eventType: data.eventType,
      severity: data.severity,
      timestamp: timestamp.toISOString(),
      clientIp: data.clientIp,
      method: data.method,
      path: data.path,
      statusCode: data.statusCode,
      userId: data.userId || "anonymous",
      userAgent: data.userAgent ?? null,
      details: data.details ?? null,
    });

    return createHmac("sha256", this.hmacKey).update(payload).digest("hex");
  }

  private dispatchCriticalAlertSms(
    params: RecordAuditEventParams,
    phone: string,
  ): void {
    const now = Date.now();
    const lastSent = this.smsCooldownByEvent.get(params.eventType) ?? 0;
    if (now - lastSent < SecurityAuditService.SMS_COOLDOWN_MS) {
      return;
    }
    if (this.smsCooldownByEvent.size >= 256) {
      this.smsCooldownByEvent.clear();
    }
    this.smsCooldownByEvent.set(params.eventType, now);

    const alertMessage = `INCIDENTE CRITICO: ${params.eventType} en ${params.path} [${params.method}]. ReqId: ${params.requestId}`;
    this.birdSmsService
      ?.sendNotificationSms({
        to: phone,
        title: "ALERTA CRITICA BSKMT",
        message: alertMessage,
      })
      .then((success) => {
        if (!success) {
          this.logger.warn(
            `No se pudo despachar SMS de alerta crítica para req ${params.requestId}`,
          );
        }
      })
      .catch((err: unknown) => {
        this.logger.error(
          `Error despachando SMS de alerta crítica: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
  }

  async recordEvent(
    params: RecordAuditEventParams,
  ): Promise<SecurityAuditLogDocument | null> {
    const timestamp = new Date();
    const signature = this.generateSignature(params, timestamp);

    try {
      const record = await this.auditModel.create({
        ...params,
        timestamp,
        signature,
      });

      if (params.severity === AuditSeverity.CRITICAL) {
        this.logger.error(
          JSON.stringify({
            alert: "CRITICAL_SECURITY_INCIDENT_RECORDED",
            requestId: params.requestId,
            eventType: params.eventType,
            path: params.path,
            clientIp: params.clientIp,
          }),
        );

        // NIST CSF 2.0 RS.CO-02: Despacho automatizado de SMS ante incidentes críticos
        if (this.birdSmsService && this.alertPhone) {
          this.dispatchCriticalAlertSms(params, this.alertPhone);
        }
      }

      return record;
    } catch (err: unknown) {
      this.logger.error(
        `Error al persistir registro de auditoría de seguridad: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }
}
