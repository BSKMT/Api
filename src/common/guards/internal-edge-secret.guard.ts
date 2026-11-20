import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import type { Request } from "express";

/**
 * Auth-before-validation guard for internal endpoints invoked by Cloudflare Edge Gateway
 * (`bskmt-edge-gateway`). Validates `x-edge-secret` against `INTERNAL_EDGE_SECRET` in
 * constant time BEFORE NestJS ValidationPipe parses or validates the request body.
 */
@Injectable()
export class InternalEdgeSecretGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expectedSecret = process.env.INTERNAL_EDGE_SECRET?.trim() ?? "";
    const req = context.switchToHttp().getRequest<Request>();
    const rawHeader = req.headers["x-edge-secret"];
    const provided = (
      Array.isArray(rawHeader) ? rawHeader[0] : (rawHeader ?? "")
    ).trim();

    const providedBuf = Buffer.from(provided, "utf8");
    const expectedBuf = Buffer.from(expectedSecret, "utf8");

    if (
      !expectedSecret ||
      providedBuf.length !== expectedBuf.length ||
      !timingSafeEqual(providedBuf, expectedBuf)
    ) {
      throw new UnauthorizedException("Unauthorized internal edge request");
    }

    return true;
  }
}
