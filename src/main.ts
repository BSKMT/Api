import { Logger, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import express, { urlencoded } from "express";
import type { Request, Response, NextFunction } from "express";
import * as helmet from "helmet";
import { AppModule } from "./app.module";
import { GlobalExceptionFilter } from "./common/filters/global-exception.filter";
import type { EnvironmentConfig } from "./config/config.interface";
import { getAuth, setAuthDependencies } from "./auth/better-auth";
import type { AuthInstance } from "./auth/better-auth";
import { EmailService } from "./zoho-mail/email.service";

/** Typed shape of the `better-auth/node` module (avoids unsafe dynamic import). */
interface BetterAuthNodeModule {
  toNodeHandler: (auth: AuthInstance) => (req: Request, res: Response) => void;
}

/** Simple in-memory rate limit store for Better Auth raw handler (M-3). */
const authRateLimit = new Map<string, { count: number; resetAt: number }>();

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    cors: false,
    rawBody: true,
    bodyParser: false,
  });

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

  const emailService = app.get(EmailService);
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
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
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
    const path = req.path;
    if (path === "/me" || path === "/me/") {
      return next();
    }

    // Simple rate-limit for sensitive Better Auth endpoints (M-3).
    // The ThrottlerGuard does not cover these raw Express routes.
    const sensitivePaths = [
      "/sign-in/email",
      "/sign-up/email",
      "/reset-password",
      "/request-password-reset",
    ];
    if (sensitivePaths.includes(path)) {
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
        return;
      }
      if (!entry || now >= entry.resetAt) {
        authRateLimit.set(key, { count: 1, resetAt: now + windowMs });
      } else {
        entry.count++;
      }
    }

    return authHandler(req, res);
  });

  app.use(urlencoded({ extended: true, limit: "1mb" }));
  app.use(express.json({ limit: "1mb" }));

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
