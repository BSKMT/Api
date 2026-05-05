import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      const message: string[] =
        typeof exceptionResponse === 'string'
          ? [exceptionResponse]
          : Array.isArray(
                (exceptionResponse as Record<string, unknown>).message,
              )
            ? ((exceptionResponse as Record<string, unknown>)
                .message as string[])
            : [JSON.stringify(exceptionResponse)];

      if (status >= 500) {
        this.logger.error(
          `HTTP ${status}: ${JSON.stringify(message)}`,
          exception.stack,
        );
      }

      return response.status(status).json({
        statusCode: status,
        message,
        timestamp: new Date().toISOString(),
      });
    }

    this.logger.error(
      'Unhandled exception',
      exception instanceof Error ? exception.stack : String(exception),
    );

    return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: ['Error interno del servidor'],
      timestamp: new Date().toISOString(),
    });
  }
}
