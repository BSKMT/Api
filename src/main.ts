import { Logger, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import express, { urlencoded } from "express";
import type { Request, Response } from "express";
import { AppModule } from "./app.module";
import { GlobalExceptionFilter } from "./common/filters/global-exception.filter";
import type { EnvironmentConfig } from "./config/config.interface";
import { getAuth, setAuthDependencies } from "./auth/better-auth";
import { BirdEmailService } from "./bird/bird-email.service";
import { createBetterAuthMiddleware } from "./bootstrap/auth-handler";
import { setupSecurityMiddleware } from "./bootstrap/security";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    cors: false,
    bodyParser: false,
  });

  const configService = app.get(ConfigService<EnvironmentConfig>);
  const emailService = app.get(BirdEmailService);

  const landingPageUrl =
    configService.get<string>("LANDING_PAGE_URL", { infer: true }) ??
    "http://localhost:4321";

  const panelUrl =
    configService.get<string>("PANEL_URL", { infer: true }) ??
    "http://localhost:3000";

  // Auth emails point directly to the panel
  setAuthDependencies(emailService, panelUrl);

  setupSecurityMiddleware(app, configService, panelUrl, landingPageUrl);

  /**
   * Mount Better Auth handler at /api/auth/*
   *
   * Better Auth needs the raw request body, so we mount it BEFORE
   * any Express body parsers. We skip /api/auth/me so NestJS
   * can handle the custom /me endpoint via AuthController.
   */
  const auth = await getAuth();
  const betterAuthMiddleware = await createBetterAuthMiddleware(auth);
  app.use("/api/auth", betterAuthMiddleware);

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
