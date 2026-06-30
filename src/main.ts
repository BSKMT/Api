import { Logger, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import * as helmet from "helmet";
import { urlencoded } from "express";
import { AppModule } from "./app.module";
import { GlobalExceptionFilter } from "./common/filters/global-exception.filter";
import type { EnvironmentConfig } from "./config/config.interface";
import { getAuth, setAuthDependencies } from "./auth/better-auth";
import { EmailService } from "./zoho-mail/email.service";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    cors: false,
    rawBody: true,
    bodyParser: false,
  });

  const configService = app.get(ConfigService<EnvironmentConfig>);

  app.use(helmet.default());

  const emailService = app.get(EmailService);
  const landingPageUrl =
    configService.get<string>("LANDING_PAGE_URL", { infer: true }) ??
    "http://localhost:4321";
  setAuthDependencies(emailService, landingPageUrl);

  const corsOrigin =
    configService.get("CORS_ORIGIN", { infer: true }) ?? "https://bskmt.com";
  app.enableCors({
    origin: [corsOrigin, "https://bskmt.com"],
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
  const { toNodeHandler } = await import("better-auth/node");
  const authHandler = toNodeHandler(auth);
  app.use("/api/auth", (req: Request, res: Response, next: NextFunction) => {
    const path = req.path;
    if (path === "/me" || path === "/me/") {
      return next();
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
