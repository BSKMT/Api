import { ExceptionFilter, ArgumentsHost } from '@nestjs/common';
import type { Response } from 'express';
export declare class GlobalExceptionFilter implements ExceptionFilter {
    private readonly logger;
    catch(exception: unknown, host: ArgumentsHost): Response<any, Record<string, any>>;
}
