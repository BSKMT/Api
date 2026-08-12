import { Logger, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import express, { urlencoded } from "express";
import type { Request, Response, NextFunction } from "express";
import * as helmet from "helmet";
import { AppModule } from "./app.module";
import { GlobalExceptionFilter } from "./common/filters/global-exception.filter";
import type { EnvironmentConfig } from "./config/config.interface";
import { getAuth, setAuthDependencies } from "./auth/better-auth";
import type { AuthInstance } from "./auth/better-auth";
import { BirdEmailService } from "./bird/bird-email.service";
import { AbuseIpDbService } from "./abuseipdb/abuseipdb.service";
import { createAbuseIpDbMiddleware } from "./abuseipdb/abuseipdb.middleware";

/** Typed shape of the `better-auth/node` module (avoids unsafe dynamic import). */
interface BetterAuthNodeModule {
  toNodeHandler: (auth: AuthInstance) => (req: Request, res: Response) => void;
}

/** Simple in-memory rate limit store for Better Auth raw handler (M-3). */
const authRateLimit = new Map<string, { count: number; resetAt: number }>();
// M20: Cap the map size to prevent unbounded memory growth on serverless
const AUTH_RATE_LIMIT_MAX_SIZE = 5000;

const SENSITIVE_AUTH_PATHS = new Set([
  "/sign-in/email",
  "/sign-up/email",
  "/reset-password",
  "/request-password-reset",
]);

function shouldSkipAuthRoute(path: string): boolean {
  return path === "/me" || path === "/me/" || path.startsWith("/login-otp/");
}

function enforceAuthRateLimit(
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

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    cors: false,
    bodyParser: false,
  });

  /**
   * trust proxy — Necesario porque el API corre detras de Cloudflare + Vercel.
   * Sin esta configuracion, `req.ip` devuelve la IP del proxy,
   * no la IP real del cliente, lo que hace inefectivo el rate limiting.
   *
   * M21: Cambiado de 1 a 2 hops para account for Cloudflare -> Vercel -> origin.
   * Validar el comportamiento exacto de XFF en Vercel durante la remediacion.
   * Si Vercel stripped client-set XFF, se puede volver a 1.
   * Ref: https://expressjs.com/en/guide/behind-proxies.html
   */
  app.set("trust proxy", 2);

  const configService = app.get(ConfigService<EnvironmentConfig>);

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

  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=()",
    );
    next();
  });

  /**
   * AbuseIPDB IP reputation middleware — blocks IPs flagged as malicious
   * by AbuseIPDB before they reach the auth handler or any route.
   * Mounted after helmet/CORS/Permissions-Policy but before the Better
   * Auth handler and body parsers so malicious IPs are rejected early
   * (OWASP A07 — Authentication Failures).
   *
   * Fail-open: when disabled, misconfigured, or the circuit breaker is
   * open, the middleware passes through without blocking (OWASP A10).
   */
  const abuseIpDbService = app.get(AbuseIpDbService);
  app.use(createAbuseIpDbMiddleware(abuseIpDbService));

  const emailService = app.get(BirdEmailService);
  const landingPageUrl =
    configService.get<string>("LANDING_PAGE_URL", { infer: true }) ??
    "http://localhost:4321";
  setAuthDependencies(emailService, landingPageUrl);

  const corsOrigin =
    configService.get("CORS_ORIGIN", { infer: true }) ?? "https://bskmt.com";
  app.enableCors({
    origin: corsOrigin,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization", "X-CSRF-Token"],
    maxAge: 86400,
  });

  // M-1: CSRF protection — verify Origin/Referer for state-changing requests
  const allowedOrigins = new Set([
    corsOrigin,
    "https://www.bskmt.com",
    "https://bskmt.com",
  ]);
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
      return next();
    }
    // Exempt external webhook endpoints
    if (
      req.path === "/api/payments/webhook" ||
      req.path === "/api/membership/webhook" ||
      req.path.startsWith("/api/internal/cron/") ||
      req.path === "/api/membership/internal/cron/sweep-pending" ||
      req.path === "/api/events/internal/cron/sweep-stale-registrations"
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
      } catch {
        // Invalid referer, allow (defense-in-depth, not primary)
      }
    }
    // M22: No Origin and no Referer — reject for state-changing requests
    // Webhook endpoints are already exempt above. All other state-changing
    // requests from browser-like clients should include Origin or Referer.
    return res
      .status(403)
      .json({ message: "Origin or Referer header required" });
  });

  /**
   * Mount Better Auth handler at /api/auth/*
   *
   * Better Auth needs the raw request body, so we mount it BEFORE
   * any Express body parsers. We skip /api/auth/me so NestJS
   * can handle the custom /me endpoint via AuthController.
   */
  const auth = await getAuth();
  const { toNodeHandler } =
    (await import("better-auth/node")) as BetterAuthNodeModule;
  const authHandler = toNodeHandler(auth);
  app.use("/api/auth", (req: Request, res: Response, next: NextFunction) => {
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
  });

  app.use(urlencoded({ extended: true, limit: "1mb" }));
  app.use(
    express.json({
      limit: "1mb",
      verify: (req: Request, _res: Response, buf: Buffer) => {
        (req as Request & { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new GlobalExceptionFilter());

  app.setGlobalPrefix("api", {
    exclude: ["/"],
  });

  const port = Number(configService.get<number>("PORT", 3000) ?? 3000);
  await app.listen(port);

  new Logger("Bootstrap").log(`BSKMT API running on port ${port}`);
}
void bootstrap();
