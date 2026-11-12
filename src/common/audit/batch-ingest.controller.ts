import {
  Controller,
  Post,
  Headers,
  Body,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Public } from "../decorators";
import { SecurityAuditService, AuditSeverity } from "./security-audit.service";
import type { EnvironmentConfig } from "../../config/config.interface";

interface IngestEventDto {
  requestId?: string;
  type?: string;
  action?: string;
  eventType?: string;
  severity?: string;
  clientIp?: string;
  method?: string;
  path?: string;
  statusCode?: number;
  userId?: string | null;
  metadata?: Record<string, unknown>;
}

interface IngestPayloadDto {
  events: IngestEventDto[];
}

function parseAuditSeverity(val?: string): AuditSeverity {
  if (val === "CRITICAL") return AuditSeverity.CRITICAL;
  if (val === "ERROR") return AuditSeverity.ERROR;
  if (val === "WARN") return AuditSeverity.WARN;
  return AuditSeverity.INFO;
}

@Controller("internal")
export class BatchIngestController {
  private readonly logger = new Logger(BatchIngestController.name);

  constructor(
    private readonly auditService: SecurityAuditService,
    private readonly configService: ConfigService<EnvironmentConfig>,
  ) {}

  @Public()
  @Post("batch-ingest")
  @HttpCode(HttpStatus.OK)
  async handleBatchIngest(
    @Headers("x-edge-secret") edgeSecret: string | undefined,
    @Body() payload: IngestPayloadDto,
  ) {
    const expectedSecret =
      this.configService.get<string>("INTERNAL_EDGE_SECRET", { infer: true }) ||
      "bskmt-edge-shared-secret";

    if (!edgeSecret || edgeSecret !== expectedSecret) {
      throw new BadRequestException("Unauthorized edge request");
    }

    if (!payload?.events || !Array.isArray(payload.events)) {
      throw new BadRequestException("Invalid events format");
    }

    const results = await Promise.allSettled(
      payload.events.map(async (evt) => {
        if (evt.type === "SECURITY_AUDIT" || evt.type === "AUDIT_LOG") {
          await this.auditService.recordEvent({
            requestId: evt.requestId || `edge-${Date.now()}`,
            eventType: evt.action || evt.eventType || "EDGE_EVENT",
            severity: parseAuditSeverity(evt.severity),
            clientIp: evt.clientIp || "edge",
            method: evt.method || "QUEUE",
            path: evt.path || "/edge-queue",
            statusCode:
              typeof evt.statusCode === "number" ? evt.statusCode : 200,
            userId: typeof evt.userId === "string" ? evt.userId : null,
            details: evt.metadata,
          });
        }
      }),
    );

    let ingested = 0;
    for (const res of results) {
      if (res.status === "fulfilled") {
        ingested++;
      } else {
        this.logger.warn(
          `Failed to record batched event: ${res.reason instanceof Error ? res.reason.message : String(res.reason)}`,
        );
      }
    }

    return { received: true, count: payload.events.length, ingested };
  }
}
