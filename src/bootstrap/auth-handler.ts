import type { Request, Response, NextFunction } from "express";
import type { AuthInstance } from "../auth/better-auth";

/** Typed shape of the `better-auth/node` module (avoids unsafe dynamic import). */
interface BetterAuthNodeModule {
  toNodeHandler: (auth: AuthInstance) => (req: Request, res: Response) => void;
}

const authRateLimit = new Map<string, { count: number; resetAt: number }>();
const MAX_MAP_SIZE = 10_000;

export const SENSITIVE_AUTH_PATHS = new Set([
  "/sign-in/email",
  "/sign-up/email",
  "/reset-password",
  "/request-password-reset",
]);

export function shouldSkipAuthRoute(path: string): boolean {
  return path === "/me" || path === "/me/" || path.startsWith("/login-otp/");
}

function resolveAuthClientIp(req: Request): string {
  const verifiedReq = req as Request & { cfOriginVerified?: boolean };
  const canTrustCf =
    verifiedReq.cfOriginVerified === true ||
    process.env.NODE_ENV !== "production" ||
    Boolean(process.env.CF_ORIGIN_SECRET?.trim());
  const cfIp = canTrustCf ? req.headers["cf-connecting-ip"] : undefined;
  const realIp = Array.isArray(cfIp) ? cfIp[0] : cfIp;
  if (typeof realIp === "string" && realIp.trim().length > 0) {
    return realIp.trim();
  }
  return req.ip || req.socket.remoteAddress || "unknown";
}

function pruneAuthRateLimit(now: number): void {
  if (authRateLimit.size <= MAX_MAP_SIZE) return;
  for (const [k, v] of authRateLimit) {
    if (now >= v.resetAt) {
      authRateLimit.delete(k);
    }
  }
  while (authRateLimit.size > MAX_MAP_SIZE) {
    const oldestKey = authRateLimit.keys().next().value;
    if (oldestKey === undefined) break;
    authRateLimit.delete(oldestKey);
  }
}

export function enforceAuthRateLimit(
  req: Request,
  res: Response,
  path: string,
): boolean {
  const ip = resolveAuthClientIp(req);
  const key = `${ip}:${path}`;
  const now = Date.now();
  const windowMs = 60000;
  const maxRequests = 10;
  const entry = authRateLimit.get(key);
  if (entry && entry.count >= maxRequests && now < entry.resetAt) {
    res
      .status(429)
      .json({ message: "Too many requests. Please try again later." });
    return false;
  }
  if (!entry || now >= entry.resetAt) {
    authRateLimit.set(key, { count: 1, resetAt: now + windowMs });
  } else {
    entry.count++;
  }
  pruneAuthRateLimit(now);
  return true;
}

export async function createBetterAuthMiddleware(auth: AuthInstance) {
  const { toNodeHandler } =
    (await import("better-auth/node")) as BetterAuthNodeModule;
  const authHandler = toNodeHandler(auth);

  return (req: Request, res: Response, next: NextFunction) => {
    const rawPath = req.path.replace(/\/{2,}/g, "/");
    const path = rawPath.length > 1 ? rawPath.replace(/\/+$/, "") : rawPath;
    if (shouldSkipAuthRoute(rawPath)) {
      return next();
    }
    if (path === "/sign-in/email") {
      return res.status(404).json({ message: "Not Found" });
    }
    if (SENSITIVE_AUTH_PATHS.has(path)) {
      if (!enforceAuthRateLimit(req, res, path)) {
        return;
      }
    }
    return authHandler(req, res);
  };
}
