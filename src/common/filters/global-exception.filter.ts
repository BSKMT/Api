import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Response } from "express";

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      const message: string[] = [];
      if (typeof exceptionResponse === "string") {
        message.push(exceptionResponse);
      } else if (
        Array.isArray((exceptionResponse as Record<string, unknown>).message)
      ) {
        message.push(
          ...((exceptionResponse as Record<string, unknown>)
            .message as string[]),
        );
      } else if (
        typeof (exceptionResponse as Record<string, unknown>).message ===
        "string"
      ) {
        message.push(
          (exceptionResponse as Record<string, unknown>).message as string,
        );
      } else {
        message.push(JSON.stringify(exceptionResponse));
      }

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

    // Handle database-level errors gracefully
    const dbErr = exception as {
      name?: string;
      code?: number;
      message?: string;
      errors?: Record<string, { message?: string }>;
    };

    if (dbErr?.name === "CastError") {
      return response.status(HttpStatus.BAD_REQUEST).json({
        statusCode: HttpStatus.BAD_REQUEST,
        message: ["Identificador o parámetro con formato inválido"],
        error: "Bad Request",
        timestamp: new Date().toISOString(),
      });
    }

    if (dbErr?.code === 11000) {
      return response.status(HttpStatus.CONFLICT).json({
        statusCode: HttpStatus.CONFLICT,
        message: ["El registro o recurso ya existe"],
        error: "Conflict",
        timestamp: new Date().toISOString(),
      });
    }

    if (dbErr?.name === "ValidationError" && dbErr?.errors) {
      const messages = Object.values(dbErr.errors).map(
        (e) => e?.message || "Error de validación en esquema",
      );
      return response.status(HttpStatus.BAD_REQUEST).json({
        statusCode: HttpStatus.BAD_REQUEST,
        message: messages.length > 0 ? messages : ["Error de validación"],
        error: "Bad Request",
        timestamp: new Date().toISOString(),
      });
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
