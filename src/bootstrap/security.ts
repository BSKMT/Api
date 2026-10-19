import { timingSafeEqual } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { ConfigService } from "@nestjs/config";
import type { Request, Response, NextFunction } from "express";
import type { EnvironmentConfig } from "../config/config.interface";

function isConstantTimeMatch(provided: string, expected: string): boolean {
  const bufA = Buffer.from(provided, "utf8");
  const bufB = Buffer.from(expected, "utf8");
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
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
    ],
    maxAge: 86400,
  });

  const allowedOrigins = new Set(allowedOriginsList);
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
      return next();
    }
    const normalizedPath = (req.path || "").replace(/\/+$/, "");
    if (
      normalizedPath === "/api/payments/webhook" ||
      normalizedPath === "/api/membership/webhook" ||
      normalizedPath === "/api/alegra/webhook" ||
      normalizedPath.startsWith("/api/internal/cron/") ||
      normalizedPath === "/api/membership/internal/cron/sweep-pending" ||
      normalizedPath ===
        "/api/events/internal/cron/sweep-stale-registrations" ||
      normalizedPath === "/api/shop/internal/cron/expire-pending" ||
      normalizedPath === "/api/internal/webhooks/bird/realtime" ||
      normalizedPath === "/api/garage/allied/service-order"
    ) {
      return next();
    }

    const origin = req.headers.origin;
    const referer = req.headers.referer;

    if (origin) {
      if (!allowedOrigins.has(origin)) {
        return res.status(403).json({ message: "Origin not allowed" });
      }
      return next();
    }
    if (referer) {
      try {
        const refererOrigin = new URL(referer).origin;
        if (!allowedOrigins.has(refererOrigin)) {
          return res
            .status(403)
            .json({ message: "Referer origin not allowed" });
        }
        return next();
      } catch {
        return res.status(403).json({ message: "Invalid referer header" });
      }
    }

    // Android / Native App requests without browser Origin/Referer headers
    const userAgent = (req.headers["user-agent"] as string) ?? "";
    if (
      req.headers["x-device-platform"] === "android" &&
      (userAgent.includes("BSK") ||
        userAgent.includes("Expo") ||
        userAgent.includes("okhttp") ||
        userAgent.includes("CFNetwork"))
    ) {
      return next();
    }

    return res
      .status(403)
      .json({ message: "Origin or Referer header required" });
  });
}
