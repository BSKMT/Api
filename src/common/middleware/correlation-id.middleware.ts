import { Injectable, NestMiddleware } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

/**
 * Middleware para correlación y trazabilidad de solicitudes HTTP.
 * Satisface NIST CSF 2.0 DE.AE-03, RS.AN-03 y RS.AN-07.
 *
 * Extrae o genera un identificador único de solicitud (x-request-id)
 * garantizando formato seguro y propagándolo tanto en el request como en la
 * cabecera de respuesta para trazabilidad de extremo a extremo.
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  private static readonly SAFE_ID_REGEX = /^[a-zA-Z0-9_-]{8,64}$/;

  use(req: Request, res: Response, next: NextFunction): void {
    const rawHeader = req.headers["x-request-id"];
    const candidateId = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;

    const requestId =
      typeof candidateId === "string" &&
      CorrelationIdMiddleware.SAFE_ID_REGEX.test(candidateId.trim())
        ? candidateId.trim()
        : randomUUID();

    req.headers["x-request-id"] = requestId;
    (req as Request & { id?: string }).id = requestId;
    res.setHeader("X-Request-Id", requestId);

    next();
  }
}
