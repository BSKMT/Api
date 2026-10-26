import { timingSafeEqual } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { ConfigService } from "@nestjs/config";
import type { Request, Response, NextFunction } from "express";
import type { EnvironmentConfig } from "../config/config.interface";
import { validateDoubleSubmitCsrf } from "../common/csrf/csrf.helper";

function isConstantTimeMatch(provided: string, expected: string): boolean {
  const bufA = Buffer.from(provided, "utf8");
  const bufB = Buffer.from(expected, "utf8");
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

const CSRF_EXEMPT_PATHS = new Set([
  "/api/payments/webhook",
  "/api/membership/webhook",
  "/api/alegra/webhook",
  "/api/membership/internal/cron/sweep-pending",
  "/api/events/internal/cron/sweep-stale-registrations",
  "/api/shop/internal/cron/expire-pending",
  "/api/internal/webhooks/bird/realtime",
  "/api/garage/allied/service-order",
]);

function isCsrfExemptPath(path: string): boolean {
  const normalized = (path || "").replace(/\/+$/, "");
  return (
    CSRF_EXEMPT_PATHS.has(normalized) ||
    normalized.startsWith("/api/internal/cron/")
  );
}

function isOriginAllowed(
  req: Request,
  allowedOrigins: Set<string>,
): boolean | null {
  if (req.headers.origin) return allowedOrigins.has(req.headers.origin);
  if (req.headers.referer) {
    try {
      return allowedOrigins.has(new URL(req.headers.referer).origin);
    } catch {
      return false;
    }
  }
  return null;
}

const NATIVE_UA_SUBSTRINGS = ["BSK", "Expo", "okhttp", "CFNetwork"];

function isNativeAppClient(req: Request): boolean {
  const platform = req.headers["x-device-platform"];
  if (platform !== "android" && platform !== "ios") return false;
  const userAgent = (req.headers["user-agent"] as string) ?? "";
  return NATIVE_UA_SUBSTRINGS.some((s) => userAgent.includes(s));
}

function validateCsrfHeaderIfPresent(req: Request, secret: string): boolean {
  const csrfHeader = Array.isArray(req.headers["x-csrf-token"])
    ? req.headers["x-csrf-token"][0]
    : req.headers["x-csrf-token"];
  if (!csrfHeader) return true;

  const cookieHeader = req.headers.cookie ?? "";
  const match = /(?:^|;\s*)bskmt\.csrf=([^;]*)/.exec(cookieHeader);
  const csrfCookie = match ? decodeURIComponent(match[1]) : undefined;
  return validateDoubleSubmitCsrf(csrfHeader, csrfCookie, secret);
}

const VERCEL_INTERNAL_PATHS = new Set([
  "/api/health",
  "/api/membership/internal/cron/sweep-pending",
  "/api/events/internal/cron/sweep-stale-registrations",
  "/api/shop/internal/cron/expire-pending",
]);

function isVercelInternalCronOrHealthPath(rawPath: string): boolean {
  const normalizedPath = (rawPath || "").replace(/\/+$/, "");
  return (
    VERCEL_INTERNAL_PATHS.has(normalizedPath) ||
    normalizedPath.startsWith("/api/internal/cron/")
  );
}

function evaluateOriginAccess(
  req: Request,
  cfOriginSecret: string,
  isProduction: boolean,
): { allowed: boolean; verified: boolean } {
  if (!cfOriginSecret) {
    return { allowed: true, verified: !isProduction };
  }
  const headerVal = req.headers["x-cf-origin-secret"];
  const providedSecret = Array.isArray(headerVal) ? headerVal[0] : headerVal;
  const isSecretValid =
    typeof providedSecret === "string" &&
    isConstantTimeMatch(providedSecret, cfOriginSecret);
  if (isSecretValid) {
    return { allowed: true, verified: true };
  }
  if (isVercelInternalCronOrHealthPath(req.path)) {
    return { allowed: true, verified: !isProduction };
  }
  return { allowed: false, verified: false };
}

function applyVerifiedCloudflareIp(req: Request, verified: boolean): void {
  if (!verified) {
    delete req.headers["cf-connecting-ip"];
    return;
  }
  const cfConnectingIp = req.headers["cf-connecting-ip"];
  const realClientIp = Array.isArray(cfConnectingIp)
    ? cfConnectingIp[0]
    : cfConnectingIp;
  if (typeof realClientIp === "string" && realClientIp.trim().length > 0) {
    req.headers["x-forwarded-for"] = realClientIp.trim();
  }
}

export function setupSecurityMiddleware(
  app: NestExpressApplication,
  configService: ConfigService<EnvironmentConfig>,
  panelUrl: string,
  landingPageUrl: string,
) {
  app.set("trust proxy", 2);

  const isProduction =
    configService.get<string>("NODE_ENV", { infer: true }) === "production";
  const cfOriginSecret =
    configService.get<string>("CF_ORIGIN_SECRET", { infer: true })?.trim() ??
    "";

  app.use((req: Request, res: Response, next: NextFunction) => {
    const originCheck = evaluateOriginAccess(req, cfOriginSecret, isProduction);
    if (!originCheck.allowed) {
      return res
        .status(403)
        .json({ message: "Direct origin access is not allowed" });
    }

    (req as Request & { cfOriginVerified?: boolean }).cfOriginVerified =
      originCheck.verified;
    applyVerifiedCloudflareIp(req, originCheck.verified);

    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=()",
    );
    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate",
    );
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
    next();
  });

  app.useSecurityHeaders({
    crossOriginOpenerPolicy: { policy: "same-origin" },
    crossOriginEmbedderPolicy: { policy: "unsafe-none" },
    crossOriginResourcePolicy: { policy: "same-origin" },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        fontSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
  });

  const rawCorsOrigin =
    configService.get<string>("CORS_ORIGIN", { infer: true }) ??
    "https://bskmt.com";
  const configuredOrigins = rawCorsOrigin
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  const devOrigins = isProduction
    ? []
    : [
        "http://localhost:3000",
        "http://localhost:4321",
        "http://localhost:4322",
        "http://localhost:5173",
        "https://10.0.2.2",
      ];
  const allowedOriginsList = Array.from(
    new Set([
      ...configuredOrigins,
      "https://bskmt.com",
      "https://www.bskmt.com",
      "https://dash.bskmt.com",
      "https://console.bskmt.com",
      "https://panel.bskmt.com",
      "https://super.bskmt.com",
      landingPageUrl,
      panelUrl,
      ...devOrigins,
    ]),
  );

  app.enableCors({
    origin: (origin, callback) => {
      callback(null, !origin || allowedOriginsList.includes(origin));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
    credentials: true,
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-CSRF-Token",
      "X-Device-Platform",
      "X-App-Version",
      "X-Request-Id",
      "X-CF-Origin-Secret",
      "Accept",
    ],
    maxAge: 86400,
  });

  const allowedOrigins = new Set(allowedOriginsList);
  const configuredCsrfSecret =
    configService.get<string>("CSRF_SECRET", { infer: true }) ||
    configService.get<string>("BETTER_AUTH_SECRET", { infer: true }) ||
    process.env.CSRF_SECRET ||
    process.env.BETTER_AUTH_SECRET;
  if (!configuredCsrfSecret && isProduction) {
    throw new Error(
      "CSRF_SECRET or BETTER_AUTH_SECRET is required in production",
    );
  }
  const csrfSecret = configuredCsrfSecret || `dev-test-csrf-${process.pid}`;

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
    if (isCsrfExemptPath(req.path)) return next();
    if (!validateCsrfHeaderIfPresent(req, csrfSecret)) {
      return res.status(403).json({ message: "Invalid CSRF token" });
    }
    const originResult = isOriginAllowed(req, allowedOrigins);
    if (originResult === true) return next();
    if (originResult === false) {
      return res.status(403).json({ message: "Origin or Referer not allowed" });
    }
    if (isNativeAppClient(req)) return next();
    return res
      .status(403)
      .json({ message: "Origin or Referer header required" });
  });
}
