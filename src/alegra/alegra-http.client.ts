import { Logger } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { EnvironmentConfig } from "../config/config.interface";
import {
  ALEGRA_DEFAULT_API_URL,
  ALEGRA_DEFAULT_TIMEOUT_MS,
} from "./alegra.constants";

export function isAlegraConfigured(
  configService: ConfigService<EnvironmentConfig>,
): boolean {
  if (process.env.ALEGRA_ENABLED !== "true") return false;
  const email = configService.get<string>("ALEGRA_EMAIL", { infer: true });
  const token = configService.get<string>("ALEGRA_TOKEN", { infer: true });
  return !!(email && token);
}

export function getAlegraAuthHeader(
  configService: ConfigService<EnvironmentConfig>,
): string {
  const email = configService.get<string>("ALEGRA_EMAIL", { infer: true });
  const token = configService.get<string>("ALEGRA_TOKEN", { infer: true });
  const credentials = Buffer.from(`${email}:${token}`).toString("base64");
  return `Basic ${credentials}`;
}

export function getAlegraBaseUrl(
  configService: ConfigService<EnvironmentConfig>,
): string {
  return (
    configService.get<string>("ALEGRA_API_URL", { infer: true }) ??
    ALEGRA_DEFAULT_API_URL
  );
}

export async function makeAlegraRequest<T>(
  configService: ConfigService<EnvironmentConfig>,
  logger: Logger,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T | null> {
  if (!isAlegraConfigured(configService)) {
    logger.debug("Alegra not configured — skipping API call");
    return null;
  }

  const url = `${getAlegraBaseUrl(configService)}${path}`;
  const timeoutMs =
    Number(process.env.ALEGRA_TIMEOUT_MS) || ALEGRA_DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = {
      Authorization: getAlegraAuthHeader(configService),
      Accept: "application/json",
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    if (res.status === 429) {
      logger.warn("Alegra API rate limit exceeded (150 req/min) — backing off");
      return null;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logger.warn(
        `Alegra API ${method} ${path} returned ${res.status}: ${text.slice(0, 200)}`,
      );
      return null;
    }

    if (res.status === 204) return null;
    return (await res.json()) as T;
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      logger.warn(`Alegra API ${method} ${path} timed out (${timeoutMs}ms)`);
    } else {
      logger.warn(
        `Alegra API ${method} ${path} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
