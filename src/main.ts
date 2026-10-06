import url from "node:url";

// 1. Remove Node's native warning listener that writes DEP0169 directly to stderr
process.removeAllListeners("warning");
process.on("warning", (warning) => {
  if (
    warning.name === "DeprecationWarning" &&
    ((warning as { code?: string }).code === "DEP0169" ||
      warning.message.includes("url.parse()"))
  ) {
    return;
  }
  process.stderr.write(`${warning.name}: ${warning.message}\n`);
});

// 2. Monkey-patch url.parse to suppress process.emitWarning during internal parse calls

const originalUrlParse = url.parse.bind(url);
const mutableUrl = url as unknown as {
  parse: (...args: unknown[]) => unknown;
};
mutableUrl.parse = function patchedUrlParse(this: unknown, ...args: unknown[]) {
  const origEmitWarning = process.emitWarning.bind(process);
  (
    process as unknown as { emitWarning: (...wArgs: unknown[]) => void }
  ).emitWarning = (warning: unknown, ...rest: unknown[]) => {
    if (
      (typeof warning === "string" && warning.includes("url.parse()")) ||
      rest[1] === "DEP0169"
    ) {
      return;
    }
    return (origEmitWarning as (...wArgs: unknown[]) => void)(warning, ...rest);
  };
  try {
    return (originalUrlParse as (...a: unknown[]) => unknown).apply(this, args);
  } finally {
    process.emitWarning = origEmitWarning;
  }
};

import { Logger, RequestMethod, ValidationPipe } from "@nestjs/common";
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

let expressApp: express.Express;

export async function bootstrap(): Promise<express.Express> {
  if (expressApp) {
    return expressApp;
  }

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

  app.use((req: Request, res: Response, next: () => void) => {
    const rawPath = (req.originalUrl || req.path || req.url || "").split(
      "?",
    )[0];
    if (
      req.method === "GET" &&
      (rawPath === "/" ||
        rawPath === "" ||
        rawPath === "/api" ||
        rawPath === "/api/")
    ) {
      res.setHeader("Content-Type", "application/json");
      res.status(200).json({
        status: "ok",
        name: "BSKMT API",
        timestamp: new Date().toISOString(),
      });
      return;
    }
    next();
  });

  app.setGlobalPrefix("api", {
    exclude: [
      { path: "", method: RequestMethod.GET },
      { path: "/", method: RequestMethod.GET },
      { path: "api", method: RequestMethod.GET },
      { path: "health", method: RequestMethod.GET },
      { path: ".well-known/assetlinks.json", method: RequestMethod.GET },
    ],
  });

  await app.init();
  expressApp = app.getHttpAdapter().getInstance();

  if (process.env.VERCEL !== "1") {
    const port = Number(configService.get<number>("PORT", 3000) ?? 3000);
    await app.listen(port);
    new Logger("Bootstrap").log(`BSKMT API running on port ${port}`);
  }

  return expressApp;
}

export default async function handler(req: Request, res: Response) {
  const server = await bootstrap();
  server(req, res);
}

if (process.env.VERCEL !== "1") {
  await bootstrap();
}
