import {
  Controller,
  Post,
  Headers,
  Body,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Throttle } from "@nestjs/throttler";
import { timingSafeEqual } from "node:crypto";
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { Public } from "../decorators";
import { SecurityAuditService, AuditSeverity } from "./security-audit.service";
import type { EnvironmentConfig } from "../../config/config.interface";

class IngestEventDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  requestId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  action?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  eventType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  severity?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  clientIp?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  method?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  path?: string;

  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(599)
  statusCode?: number;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  userId?: string | null;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

class IngestPayloadDto {
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => IngestEventDto)
  events!: IngestEventDto[];
}

function isConstantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
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
  @Throttle({ default: { ttl: 60000, limit: 60 } })
  @Post("batch-ingest")
  @HttpCode(HttpStatus.OK)
  async handleBatchIngest(
    @Headers("x-edge-secret") edgeSecret: string | undefined,
    @Body() payload: IngestPayloadDto,
  ) {
    const expectedSecret = this.configService
      .get<string>("INTERNAL_EDGE_SECRET", { infer: true })
      ?.trim();

    if (
      !expectedSecret ||
      !edgeSecret ||
      !isConstantTimeEqual(edgeSecret.trim(), expectedSecret)
    ) {
      throw new UnauthorizedException("Unauthorized edge request");
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
