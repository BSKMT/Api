import type { Request, Response, NextFunction } from "express";
import type { AuthInstance } from "../auth/better-auth";

/** Typed shape of the `better-auth/node` module (avoids unsafe dynamic import). */
interface BetterAuthNodeModule {
  toNodeHandler: (auth: AuthInstance) => (req: Request, res: Response) => void;
  fromNodeHeaders: (headers: unknown) => Headers;
}

const authRateLimit = new Map<string, { count: number; resetAt: number }>();
const MAX_MAP_SIZE = 10_000;

export const SENSITIVE_AUTH_PATHS = new Set([
  "/sign-in/email",
  "/sign-up/email",
  "/send-verification-email",
  "/reset-password",
  "/request-password-reset",
  "/forget-password",
  "/change-password",
  "/change-email",
  "/delete-user",
  "/passkey/generate-authenticate-options",
  "/passkey/verify-authentication",
  "/two-factor/verify-totp",
  "/two-factor/verify-otp",
]);

const OTP_PENDING_ALLOWED_AUTH_PATHS = new Set([
  "/sign-out",
  "/get-session",
  "/sign-up/email",
  "/verify-email",
  "/send-verification-email",
  "/reset-password",
  "/request-password-reset",
  "/forget-password",
]);

export function shouldSkipAuthRoute(path: string): boolean {
  const lower = path.toLowerCase();
  return lower === "/me" || lower === "/me/" || lower.startsWith("/login-otp/");
}

function resolveAuthClientIp(req: Request): string {
  const verifiedReq = req as Request & { cfOriginVerified?: boolean };
  const canTrustCf =
    verifiedReq.cfOriginVerified === true ||
    (process.env.NODE_ENV !== "production" &&
      !process.env.CF_ORIGIN_SECRET?.trim());
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
  const windowMs = path === "/send-verification-email" ? 300_000 : 60_000;
  const maxRequests = path === "/send-verification-email" ? 3 : 10;
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

function normalizeAuthPath(raw: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (
    decoded.includes("\\") ||
    decoded.split("/").some((seg) => seg === "." || seg === "..")
  ) {
    return null;
  }
  let path = decoded.replace(/\/{2,}/g, "/").toLowerCase();
  while (path.length > 1 && path.endsWith("/")) {
    path = path.slice(0, -1);
  }
  return path;
}

export async function createBetterAuthMiddleware(auth: AuthInstance) {
  const { toNodeHandler, fromNodeHeaders } =
    (await import("better-auth/node")) as BetterAuthNodeModule;
  const authHandler = toNodeHandler(auth);

  return async (req: Request, res: Response, next: NextFunction) => {
    const path = normalizeAuthPath(req.path);
    if (path === null) {
      return res.status(400).json({ message: "Invalid auth route" });
    }
    if (shouldSkipAuthRoute(path)) {
      return next();
    }
    if (path === "/sign-in/email" || path.startsWith("/sign-in/social")) {
      return res.status(404).json({ message: "Not Found" });
    }
    if (SENSITIVE_AUTH_PATHS.has(path)) {
      if (!enforceAuthRateLimit(req, res, path)) {
        return;
      }
    }

    // F-04: Reject otpPending sessions on Better-Auth's own endpoints (e.g. passkey enroll,
    // session revocation, update-user) except sign-out / get-session / unauthenticated flows.
    const cookieHeader = req.headers.cookie ?? "";
    if (
      !OTP_PENDING_ALLOWED_AUTH_PATHS.has(path) &&
      cookieHeader.includes("better-auth.session_token")
    ) {
      try {
        const session = await auth.api.getSession({
          headers: fromNodeHeaders(req.headers),
          query: { disableCookieCache: true },
        });
        if (session?.session?.otpPending === true) {
          return res.status(401).json({
            message:
              "No autorizado — verificación de segundo factor (OTP) pendiente",
          });
        }
      } catch {
        // Proceed to authHandler if session lookup fails cleanly
      }
    }

    return authHandler(req, res);
  };
}
