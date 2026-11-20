import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import type { Request } from "express";

function isConstantTimeEqual(provided: string, expected: string): boolean {
  const bufA = Buffer.from(provided, "utf8");
  const bufB = Buffer.from(expected, "utf8");
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/**
 * Auth-before-validation guard for `POST /api/garage/allied/service-order`.
 * Rejects unauthenticated requests with 401 BEFORE NestJS ValidationPipe runs,
 * preventing DTO schema enumeration and unauthenticated payload parsing.
 */
@Injectable()
export class AlliedWorkshopGuard implements CanActivate {
  private readonly logger = new Logger(AlliedWorkshopGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const rawTokens = (process.env.ALLIED_WORKSHOP_TOKENS ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    if (rawTokens.length === 0) {
      this.logger.warn(
        "ALLIED_WORKSHOP_TOKENS no está configurado — rechazando solicitud de taller aliado.",
      );
      throw new UnauthorizedException(
        "Servicio de talleres aliados no configurado o deshabilitado.",
      );
    }

    const req = context.switchToHttp().getRequest<Request>();
    const headerRaw = req.headers["x-workshop-token"];
    const headerToken = Array.isArray(headerRaw) ? headerRaw[0] : headerRaw;
    const bodyToken =
      req.body &&
      typeof req.body === "object" &&
      typeof (req.body as { workshopAuthToken?: unknown }).workshopAuthToken ===
        "string"
        ? (req.body as { workshopAuthToken: string }).workshopAuthToken
        : "";
    const provided = (headerToken ?? bodyToken).trim();

    if (!provided) {
      throw new UnauthorizedException(
        "Token de autorización de taller aliado requerido",
      );
    }

    const isValid = rawTokens.some((entry) => {
      const [token] = entry.split(":");
      return Boolean(token) && isConstantTimeEqual(provided, token);
    });

    if (!isValid) {
      throw new UnauthorizedException(
        "Token de autorización de taller aliado inválido",
      );
    }

    return true;
  }
}
