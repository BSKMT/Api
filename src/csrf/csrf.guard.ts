import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { CsrfService } from "./csrf.service";

export const SKIP_CSRF_KEY = "skipCsrf";

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly csrfService: CsrfService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const skipCsrf = this.reflector.getAllAndOverride<boolean>(SKIP_CSRF_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (skipCsrf) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const method = request.method;

    if (["GET", "HEAD", "OPTIONS"].includes(method)) {
      return true;
    }

    const cookies = request.cookies as Record<string, string> | undefined;
    const accessToken = cookies?.access_token;

    if (!accessToken) {
      return true;
    }

    const csrfCookie = cookies?.csrf_token;
    if (!csrfCookie) {
      throw new ForbiddenException("CSRF token missing");
    }

    const headerToken =
      (request.headers["x-csrf-token"] as string | undefined) ??
      ((request.body as Record<string, unknown>)?._csrf as string | undefined);

    if (!headerToken) {
      throw new ForbiddenException("CSRF token missing in request");
    }

    if (headerToken !== csrfCookie) {
      throw new ForbiddenException("CSRF token mismatch");
    }

    if (!this.csrfService.verifyToken(csrfCookie)) {
      throw new ForbiddenException("CSRF token invalid");
    }

    return true;
  }
}
