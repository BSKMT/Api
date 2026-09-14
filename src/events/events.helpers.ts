import { BadRequestException, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { EnvironmentConfig } from "../config/config.interface";

export function clampPaginationLimit(
  limit?: string,
  defaultVal = 6,
  max = 100,
): number {
  const raw = limit ? Number.parseInt(limit, 10) : defaultVal;
  return Math.min(Math.max(Number.isFinite(raw) ? raw : defaultVal, 1), max);
}

export function assertCronSecret(
  configService: ConfigService<EnvironmentConfig>,
  logger: Logger,
  headerSecret: string | undefined,
  authorization: string | undefined,
): void {
  const expected =
    configService.get<string>("CRON_SECRET", { infer: true }) ?? "";
  if (!expected) {
    throw new BadRequestException("CRON_SECRET not configured");
  }
  const provided =
    headerSecret ??
    (authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : undefined) ??
    "";
  if (provided.length !== expected.length || provided !== expected) {
    logger.warn("Unauthorized cron invocation — secret mismatch (or missing).");
    throw new BadRequestException("Invalid or missing cron secret");
  }
}
