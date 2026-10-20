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
  private readonly hmacSecret: string;
  private readonly alertPhone?: string;

  constructor(
    @InjectModel(SecurityAuditLog.name)
    private readonly auditModel: Model<SecurityAuditLogDocument>,
    private readonly configService: ConfigService<EnvironmentConfig>,
    @Optional()
    private readonly birdSmsService?: BirdSmsService,
  ) {
    this.hmacSecret =
      this.configService.get<string>("BETTER_AUTH_SECRET", { infer: true }) ??
      "bskmt-default-audit-secret-min32ch";
    this.alertPhone =
      this.configService.get<string>("SECDEVOPS_ALERT_PHONE", {
        infer: true,
      }) ??
      process.env.SECDEVOPS_ALERT_PHONE ??
      process.env.SECURITY_ALERT_PHONE;
  }

  private generateSignature(
    data: RecordAuditEventParams,
    timestamp: Date,
  ): string {
    const payload = [
      data.requestId,
      data.eventType,
      data.severity,
      timestamp.toISOString(),
      data.clientIp,
      data.method,
      data.path,
      data.statusCode,
      data.userId || "anonymous",
    ].join("|");

    return createHmac("sha256", this.hmacSecret).update(payload).digest("hex");
  }

  private dispatchCriticalAlertSms(
    params: RecordAuditEventParams,
    phone: string,
  ): void {
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
