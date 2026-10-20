import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { CorrelationIdMiddleware } from "./correlation-id.middleware";
import type { Request, Response } from "express";

describe("CorrelationIdMiddleware (NIST CSF 2.0 DE.AE-03, RS.AN-07)", () => {
  let middleware: CorrelationIdMiddleware;

  beforeEach(() => {
    middleware = new CorrelationIdMiddleware();
  });

  it("genera un UUID v4 seguro cuando no se provee cabecera x-request-id", () => {
    const req = { headers: {} } as Request;
    const setHeaderMock = jest.fn();
    const res = {
      setHeader: setHeaderMock,
    } as unknown as Response;
    const next = jest.fn();

    middleware.use(req, res, next);

    const generatedId = req.headers["x-request-id"];
    expect(typeof generatedId).toBe("string");
    expect(generatedId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(setHeaderMock).toHaveBeenCalledWith("X-Request-Id", generatedId);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("preserva el x-request-id cuando cumple con el formato seguro", () => {
    const customId = "req-custom-secdevops-12345";
    const req = {
      headers: { "x-request-id": customId },
    } as unknown as Request;
    const setHeaderMock = jest.fn();
    const res = {
      setHeader: setHeaderMock,
    } as unknown as Response;
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(req.headers["x-request-id"]).toBe(customId);
    expect(setHeaderMock).toHaveBeenCalledWith("X-Request-Id", customId);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("reemplaza un x-request-id inseguro o con caracteres maliciosos", () => {
    const maliciousId = "invalid/id\r\nSet-Cookie: evil=1;<script>";
    const req = {
      headers: { "x-request-id": maliciousId },
    } as unknown as Request;
    const setHeaderMock = jest.fn();
    const res = {
      setHeader: setHeaderMock,
    } as unknown as Response;
    const next = jest.fn();

    middleware.use(req, res, next);

    const safeId = req.headers["x-request-id"];
    expect(safeId).not.toBe(maliciousId);
    expect(safeId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(setHeaderMock).toHaveBeenCalledWith("X-Request-Id", safeId);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
