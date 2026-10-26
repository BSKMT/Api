import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import {
  BadRequestException,
  ForbiddenException,
  HttpStatus,
  ArgumentsHost,
} from "@nestjs/common";

import { GlobalExceptionFilter } from "./global-exception.filter";
import type { SecurityAuditService } from "../audit/security-audit.service";
import type { Request, Response } from "express";

describe("GlobalExceptionFilter (NIST CSF 2.0 DE.AE-03, RS.AN-03, RS.AN-07)", () => {
  let filter: GlobalExceptionFilter;

  beforeEach(() => {
    filter = new GlobalExceptionFilter();
  });

  function createMockHost(
    reqHeaders: Record<string, string> = { "x-request-id": "trace-uuid-123" },
  ): {
    host: ArgumentsHost;
    resJson: jest.Mock;
    resStatus: jest.Mock;
  } {
    const resJson = jest.fn();
    const resStatus = jest.fn().mockReturnValue({ json: resJson });
    const mockRequest = { headers: reqHeaders } as unknown as Request;
    const mockResponse = {
      status: resStatus,
    } as unknown as Response;

    const host = {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
        getResponse: () => mockResponse,
      }),
    } as unknown as ArgumentsHost;

    return { host, resJson, resStatus };
  }

  it("captura HttpException estándar y adjunta el requestId de trazabilidad", () => {
    const { host, resStatus, resJson } = createMockHost({
      "x-request-id": "req-trace-test-1",
    });
    const exception = new BadRequestException("Parámetro inválido");

    filter.catch(exception, host);

    expect(resStatus).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(resJson).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.BAD_REQUEST,
        message: ["Parámetro inválido"],
        requestId: "req-trace-test-1",
      }),
    );
  });

  it("maneja error de colisión de clave única de Mongoose (E11000)", () => {
    const { host, resStatus, resJson } = createMockHost({
      "x-request-id": "req-conflict-dup",
    });
    const mongoConflict = { code: 11000, message: "duplicate key error" };

    filter.catch(mongoConflict, host);

    expect(resStatus).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(resJson).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.CONFLICT,
        error: "Conflict",
        message: ["El registro o recurso ya existe"],
        requestId: "req-conflict-dup",
      }),
    );
  });

  it("maneja errores no capturados retornando 500 y requestId estructurado sin filtrar stack", () => {
    const { host, resStatus, resJson } = createMockHost({
      "x-request-id": "req-500-unhandled",
    });
    const error = new Error("DB connection dropped unexpectedly");

    filter.catch(error, host);

    expect(resStatus).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(resJson).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: ["Error interno del servidor"],
        requestId: "req-500-unhandled",
      }),
    );
  });

  it("registra anomalías 403 en SecurityAuditService con requestId (DE-01)", () => {
    const recordEvent = jest.fn().mockReturnValue(Promise.resolve(null));
    const auditedFilter = new GlobalExceptionFilter({
      recordEvent,
    } as unknown as SecurityAuditService);
    const { host, resStatus } = createMockHost({
      "x-request-id": "req-403-audit",
    });

    auditedFilter.catch(new ForbiddenException("Sin permisos"), host);

    expect(resStatus).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
    expect(recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "req-403-audit",
        eventType: "ACCESS_FORBIDDEN",
        statusCode: HttpStatus.FORBIDDEN,
      }),
    );
  });
});
