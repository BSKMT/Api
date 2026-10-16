import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Response } from "express";

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

function tryHandleDatabaseError(
  dbErr: DbErrorLike,
  response: Response,
): boolean {
  if (dbErr?.name === "CastError") {
    response.status(HttpStatus.BAD_REQUEST).json({
      statusCode: HttpStatus.BAD_REQUEST,
      message: ["Identificador o parámetro con formato inválido"],
      error: "Bad Request",
      timestamp: new Date().toISOString(),
    });
    return true;
  }

  if (dbErr?.code === 11000) {
    response.status(HttpStatus.CONFLICT).json({
      statusCode: HttpStatus.CONFLICT,
      message: ["El registro o recurso ya existe"],
      error: "Conflict",
      timestamp: new Date().toISOString(),
    });
    return true;
  }

  if (dbErr?.name === "ValidationError" && dbErr?.errors) {
    const messages = Object.values(dbErr.errors).map(
      (e) => e?.message || "Error de validación en esquema",
    );
    response.status(HttpStatus.BAD_REQUEST).json({
      statusCode: HttpStatus.BAD_REQUEST,
      message: messages.length > 0 ? messages : ["Error de validación"],
      error: "Bad Request",
      timestamp: new Date().toISOString(),
    });
    return true;
  }

  return false;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  private handleHttpException(exception: HttpException, response: Response) {
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();
    const message = extractHttpMessages(exceptionResponse);

    if (status >= 500) {
      this.logger.error(
        `HTTP ${status}: ${JSON.stringify(message)}`,
        exception.stack,
      );
    }

    const payload: Record<string, unknown> = {
      statusCode: status,
      message,
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

    if (exception instanceof HttpException) {
      return this.handleHttpException(exception, response);
    }

    if (tryHandleDatabaseError(exception as DbErrorLike, response)) {
      return;
    }

    this.logger.error(
      "Unhandled exception",
      exception instanceof Error ? exception.stack : String(exception),
    );

    return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: ["Error interno del servidor"],
      timestamp: new Date().toISOString(),
    });
  }
}
