/**
 * Express middleware factory for AbuseIPDB IP blocking.
 *
 * Creates an Express middleware that checks the client IP address against
 * AbuseIPDB before any route processing. If the IP is flagged as malicious
 * (abuseConfidenceScore >= threshold), the middleware short-circuits with
 * a 403 Forbidden response.
 *
 * The middleware is mounted in `main.ts` AFTER `helmet` and CORS, but
 * BEFORE the Better Auth handler and body parsers, so that malicious IPs
 * are rejected as early as possible without consuming downstream resources.
 *
 * SECURITY (OWASP Top 10 2025):
 *   A07 - Blocks IPs flagged by AbuseIPDB to mitigate brute-force and
 *          automated attack tools before they reach auth endpoints.
 *   A09 - Logs blocked requests at `warn` level with the hashed IP
 *          (never the cleartext IP) and the abuse confidence score.
 *   A10 - If AbuseIPDB is disabled, the API key is missing, or the
 *          circuit breaker is open, the middleware passes through (fail open).
 *
 * @packageDocumentation
 */

import type { Request, Response, NextFunction } from "express";
import { AbuseIpDbService, isValidIp } from "./abuseipdb.service";

/**
 * The paths that are exempt from AbuseIPDB blocking.
 *
 * - Health check / readiness probe endpoints.
 * - Vercel cron job endpoints (these originate from Vercel's infrastructure,
 *   not from client IPs, and must always succeed).
 * - Bold payment webhooks (Bold's servers POST from their own IPs).
 *
 * These are checked by exact prefix match.
 */
const EXEMPT_PREFIXES = [
  "/api/health",
  "/api/internal/cron/",
  "/api/membership/internal/cron/",
  "/api/events/internal/cron/",
  "/api/payments/webhook",
  "/api/membership/webhook",
];

/** True when the request path matches an exempt prefix. */
function isExempt(path: string): boolean {
  return EXEMPT_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * Creates an Express middleware that blocks malicious IPs via AbuseIPDB.
 *
 * @param service — The {@link AbuseIpDbService} instance from the NestJS DI container.
 * @returns An Express middleware function.
 */
export function createAbuseIpDbMiddleware(service: AbuseIpDbService) {
  const logTag = "AbuseIpDbMiddleware";

  return async (req: Request, res: Response, next: NextFunction) => {
    if (!service.isEnabled()) {
      return next();
    }

    if (isExempt(req.path)) {
      return next();
    }

    const ip = req.ip ?? req.socket.remoteAddress ?? "";

    if (!isValidIp(ip)) {
      return next();
    }

    try {
      const malicious = await service.isMalicious(ip);
      if (malicious) {
        res.status(403).setHeader("Content-Type", "application/json");
        return res.json({ message: "Access denied" });
      }
    } catch {
      // Fail open: any unexpected error allows the request through.
      // The service itself catches errors internally, but this is defense
      // in depth in case the service throws unexpectedly (OWASP A10).
      console.warn(
        `[${logTag}] Unexpected error during IP check. Failing open.`,
      );
    }

    return next();
  };
}
