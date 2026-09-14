import type { Request, Response, NextFunction } from "express";
import type { AuthInstance } from "../auth/better-auth";

/** Typed shape of the `better-auth/node` module (avoids unsafe dynamic import). */
interface BetterAuthNodeModule {
  toNodeHandler: (auth: AuthInstance) => (req: Request, res: Response) => void;
}

const authRateLimit = new Map<string, { count: number; resetAt: number }>();
const AUTH_RATE_LIMIT_MAX_SIZE = 5000;

export const SENSITIVE_AUTH_PATHS = new Set([
  "/sign-in/email",
  "/sign-up/email",
  "/reset-password",
  "/request-password-reset",
]);

export function shouldSkipAuthRoute(path: string): boolean {
  return path === "/me" || path === "/me/" || path.startsWith("/login-otp/");
}

export function enforceAuthRateLimit(
  req: Request,
  res: Response,
  path: string,
): boolean {
  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
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
  if (authRateLimit.size > AUTH_RATE_LIMIT_MAX_SIZE) {
    for (const [k, v] of authRateLimit) {
      if (now >= v.resetAt) {
        authRateLimit.delete(k);
      }
    }
  }
  return true;
}

export async function createBetterAuthMiddleware(auth: AuthInstance) {
  const { toNodeHandler } =
    (await import("better-auth/node")) as BetterAuthNodeModule;
  const authHandler = toNodeHandler(auth);

  return (req: Request, res: Response, next: NextFunction) => {
    const path = req.path.replace(/\/{2,}/g, "/");
    if (shouldSkipAuthRoute(path)) {
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
