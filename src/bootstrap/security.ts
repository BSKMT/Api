import { timingSafeEqual } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { ConfigService } from "@nestjs/config";
import type { Request, Response, NextFunction } from "express";
import type { EnvironmentConfig } from "../config/config.interface";
import { validateDoubleSubmitCsrf } from "../common/csrf/csrf.helper";

function isConstantTimeMatch(provided: string, expected: string): boolean {
  const bufA = Buffer.from(provided, "utf8");
  const bufB = Buffer.from(expected, "utf8");
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
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
  const origin = req.headers.origin;
  if (origin) {
    return allowedOrigins.has(origin);
  }
  const referer = req.headers.referer;
  if (referer) {
    try {
      return allowedOrigins.has(new URL(referer).origin);
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

export function setupSecurityMiddleware(
  app: NestExpressApplication,
  configService: ConfigService<EnvironmentConfig>,
  panelUrl: string,
  landingPageUrl: string,
) {
  app.set("trust proxy", 2);

  const cfOriginSecret =
    configService.get<string>("CF_ORIGIN_SECRET", { infer: true })?.trim() ??
    "";

  app.use((req: Request, res: Response, next: NextFunction) => {
    // 1. Aislar el origen de Vercel exigiendo X-CF-Origin-Secret cuando está configurado (VULN-17)
    if (cfOriginSecret) {
      const normalizedPath = (req.path || "").replace(/\/+$/, "");
      const isVercelInternalCronOrHealth =
        normalizedPath === "/api/health" ||
        normalizedPath.startsWith("/api/internal/cron/") ||
        normalizedPath === "/api/membership/internal/cron/sweep-pending" ||
        normalizedPath ===
          "/api/events/internal/cron/sweep-stale-registrations" ||
        normalizedPath === "/api/shop/internal/cron/expire-pending";

      if (!isVercelInternalCronOrHealth) {
        const headerVal = req.headers["x-cf-origin-secret"];
        const providedSecret = Array.isArray(headerVal)
          ? headerVal[0]
          : headerVal;
        if (
          typeof providedSecret !== "string" ||
          !isConstantTimeMatch(providedSecret, cfOriginSecret)
        ) {
          return res
            .status(403)
            .json({ message: "Direct origin access is not allowed" });
        }
      }
    }

    // 2. Fijar la IP real desde cf-connecting-ip para evitar spoofing de X-Forwarded-For
    const cfConnectingIp = req.headers["cf-connecting-ip"];
    const realClientIp = Array.isArray(cfConnectingIp)
      ? cfConnectingIp[0]
      : cfConnectingIp;
    if (typeof realClientIp === "string" && realClientIp.trim().length > 0) {
      req.headers["x-forwarded-for"] = realClientIp.trim();
    }

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

  const isProduction =
    configService.get<string>("NODE_ENV", { infer: true }) === "production";

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
      if (!origin || allowedOriginsList.includes(origin)) {
        callback(null, true);
      } else {
        callback(null, false);
      }
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
  const betterAuthSecret =
    configService.get<string>("BETTER_AUTH_SECRET", { infer: true }) ||
    "bskmt-default-csrf-secret-min32chars";

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
      return next();
    }
    if (isCsrfExemptPath(req.path)) {
      return next();
    }

    if (!validateCsrfHeaderIfPresent(req, betterAuthSecret)) {
      return res.status(403).json({ message: "Invalid CSRF token" });
    }

    const originResult = isOriginAllowed(req, allowedOrigins);
    if (originResult === true) {
      return next();
    }
    if (originResult === false) {
      return res.status(403).json({ message: "Origin or Referer not allowed" });
    }

    if (isNativeAppClient(req)) {
      return next();
    }

    return res
      .status(403)
      .json({ message: "Origin or Referer header required" });
  });
}
