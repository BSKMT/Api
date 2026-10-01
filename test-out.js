import { Logger, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import express, { urlencoded } from "express";
import { AppModule } from "./app.module";
import { GlobalExceptionFilter } from "./common/filters/global-exception.filter";
import { getAuth, setAuthDependencies } from "./auth/better-auth";
import { BirdEmailService } from "./bird/bird-email.service";
import { createBetterAuthMiddleware } from "./bootstrap/auth-handler";
import { setupSecurityMiddleware } from "./bootstrap/security";
async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    cors: false,
    bodyParser: false
  });
  const configService = app.get(ConfigService);
  const emailService = app.get(BirdEmailService);
  const landingPageUrl = configService.get("LANDING_PAGE_URL", { infer: true }) ?? "http://localhost:4321";
  const panelUrl = configService.get("PANEL_URL", { infer: true }) ?? "http://localhost:3000";
  setAuthDependencies(emailService, panelUrl);
  setupSecurityMiddleware(app, configService, panelUrl, landingPageUrl);
  const auth = await getAuth();
  const betterAuthMiddleware = await createBetterAuthMiddleware(auth);
  app.use("/api/auth", betterAuthMiddleware);
  app.use(urlencoded({ extended: true, limit: "1mb" }));
  app.use(
    express.json({
      limit: "1mb",
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      }
    })
  );
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true }
    })
  );
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.setGlobalPrefix("api", {
    exclude: ["/"]
  });
  const port = Number(configService.get("PORT", 3e3) ?? 3e3);
  await app.listen(port);
  new Logger("Bootstrap").log(`BSKMT API running on port ${port}`);
}
void bootstrap();
