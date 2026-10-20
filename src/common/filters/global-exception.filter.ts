import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Request, Response } from "express";
import {
  SecurityAuditService,
  AuditSeverity,
} from "../audit/security-audit.service";

interface DbErrorLike {
  name?: string;
  code?: number;
  message?: string;
  errors?: Record<string, { message?: string }>;
}

function extractHttpMessages(exceptionResponse: unknown): string[] {
  if (typeof exceptionResponse === "string") {
    return [exceptionResponse];
  }
  if (typeof exceptionResponse === "object" && exceptionResponse !== null) {
    const raw = (exceptionResponse as Record<string, unknown>).message;
    if (Array.isArray(raw)) {
      return raw as string[];
    }
    if (typeof raw === "string") {
      return [raw];
    }
  }
  return [JSON.stringify(exceptionResponse)];
}

function getDatabaseErrorResponse(dbErr: DbErrorLike): {
  status: HttpStatus;
  error: string;
  message: string[];
} | null {
  if (dbErr?.name === "CastError") {
    return {
      status: HttpStatus.BAD_REQUEST,
      error: "Bad Request",
      message: ["Identificador o parámetro con formato inválido"],
    };
  }

  if (dbErr?.code === 11000) {
    return {
      status: HttpStatus.CONFLICT,
      error: "Conflict",
      message: ["El registro o recurso ya existe"],
    };
  }

  if (dbErr?.name === "ValidationError" && dbErr?.errors) {
    const messages = Object.values(dbErr.errors).map(
      (e) => e?.message || "Error de validación en esquema",
    );
    return {
      status: HttpStatus.BAD_REQUEST,
      error: "Bad Request",
      message: messages.length > 0 ? messages : ["Error de validación"],
    };
  }

  return null;
}

function extractRequestId(req?: Request): string {
  if (!req?.headers) return "unknown";
  const raw = req.headers["x-request-id"];
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  return typeof candidate === "string" && candidate.length > 0
    ? candidate
    : (req as Request & { id?: string }).id || "unknown";
}

/**
 * Filtro global de excepciones con correlación y auditoría inmutable de incidentes.
 * Satisface NIST CSF 2.0 DE.AE-03, RS.AN-03, RS.AN-06 y RS.AN-07.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  constructor(private readonly auditService?: SecurityAuditService) {}

  private handleHttpException(
    exception: HttpException,
    response: Response,
    request: Request,
    requestId: string,
  ) {
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();
    const message = extractHttpMessages(exceptionResponse);

    if (status >= 500) {
      this.logger.error(
        JSON.stringify({
          event: "HTTP_SERVER_ERROR",
          statusCode: status,
          requestId,
          message,
        }),
        exception.stack,
      );

      if (this.auditService) {
        void this.auditService.recordEvent({
          requestId,
          eventType: "HTTP_SERVER_ERROR",
          severity: AuditSeverity.ERROR,
          clientIp: request.ip || "unknown",
          method: request.method || "UNKNOWN",
          path: request.originalUrl || request.url || "unknown",
          statusCode: status,
          details: { message },
        });
      }
    }

    const payload: Record<string, unknown> = {
      statusCode: status,
      message,
      requestId,
      timestamp: new Date().toISOString(),
    };
    if (
      exceptionResponse &&
      typeof exceptionResponse === "object" &&
      "error" in exceptionResponse &&
      typeof (exceptionResponse as Record<string, unknown>).error === "string"
    ) {
      payload.error = (exceptionResponse as Record<string, unknown>).error;
    }

    return response.status(status).json(payload);
  }

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = extractRequestId(request);

    if (exception instanceof HttpException) {
      return this.handleHttpException(exception, response, request, requestId);
    }

    const dbErrorMatch = getDatabaseErrorResponse(exception as DbErrorLike);
    if (dbErrorMatch) {
      return response.status(dbErrorMatch.status).json({
        statusCode: dbErrorMatch.status,
        message: dbErrorMatch.message,
        error: dbErrorMatch.error,
        requestId,
        timestamp: new Date().toISOString(),
      });
    }

    this.logger.error(
      JSON.stringify({
        event: "UNHANDLED_EXCEPTION",
        requestId,
        error:
          exception instanceof Error ? exception.message : String(exception),
      }),
      exception instanceof Error ? exception.stack : undefined,
    );

    if (this.auditService) {
      void this.auditService.recordEvent({
        requestId,
        eventType: "UNHANDLED_EXCEPTION",
        severity: AuditSeverity.CRITICAL,
        clientIp: request?.ip || "unknown",
        method: request?.method || "UNKNOWN",
        path: request?.originalUrl || request?.url || "unknown",
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        details: {
          error:
            exception instanceof Error ? exception.message : String(exception),
        },
      });
    }

    return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: ["Error interno del servidor"],
      requestId,
      timestamp: new Date().toISOString(),
    });
  }
}
