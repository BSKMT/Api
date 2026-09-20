import type { NestExpressApplication } from "@nestjs/platform-express";
import type { ConfigService } from "@nestjs/config";
import type { Request, Response, NextFunction } from "express";
import * as helmet from "helmet";
import type { EnvironmentConfig } from "../config/config.interface";

export function setupSecurityMiddleware(
  app: NestExpressApplication,
  configService: ConfigService<EnvironmentConfig>,
  panelUrl: string,
  landingPageUrl: string,
) {
  app.set("trust proxy", 2);

  app.use(
    helmet.default({
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
    }),
  );

  app.use((_req: Request, res: Response, next: NextFunction) => {
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
    next();
  });

  const rawCorsOrigin =
    configService.get<string>("CORS_ORIGIN", { infer: true }) ??
    "https://bskmt.com";
  const configuredOrigins = rawCorsOrigin
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  const allowedOriginsList = Array.from(
    new Set([
      ...configuredOrigins,
      "https://bskmt.com",
      "https://www.bskmt.com",
      "https://dash.bskmt.com",
      landingPageUrl,
      panelUrl,
      "http://localhost:3000",
      "http://localhost:4321",
      "http://localhost:4322",
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
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
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
    if (
      req.path === "/api/payments/webhook" ||
      req.path === "/api/membership/webhook" ||
      req.path === "/api/alegra/webhook" ||
      req.path.startsWith("/api/internal/cron/") ||
      req.path === "/api/membership/internal/cron/sweep-pending" ||
      req.path === "/api/events/internal/cron/sweep-stale-registrations" ||
      req.path === "/api/internal/webhooks/bird/realtime"
    ) {
      return next();
    }

    // Android Native App requests: verified by X-Device-Platform
    if (req.headers["x-device-platform"] === "android") {
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
      } catch {
        // Invalid referer, allow (defense-in-depth, not primary)
      }
    }
    return res
      .status(403)
      .json({ message: "Origin or Referer header required" });
  });
}
