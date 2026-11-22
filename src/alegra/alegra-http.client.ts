import { Logger } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { EnvironmentConfig } from "../config/config.interface";
import { sanitizeForLog } from "../common/utils/log-redact.util";
import {
  ALEGRA_ALLOWED_API_HOSTS,
  ALEGRA_DEFAULT_API_URL,
  ALEGRA_DEFAULT_TIMEOUT_MS,
  ALEGRA_MAX_TIMEOUT_MS,
  ALEGRA_MIN_TIMEOUT_MS,
} from "./alegra.constants";

export type AlegraHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface AlegraDetailedResponse<T> {
  ok: boolean;
  status: number;
  data: T | null;
  errorText: string | null;
}

export type AlegraDetailedRequestFn = <T>(
  method: AlegraHttpMethod,
  path: string,
  body?: unknown,
) => Promise<AlegraDetailedResponse<T>>;

export function isAlegraConfigured(
  configService: ConfigService<EnvironmentConfig>,
): boolean {
  const rawEnabled: unknown = configService.get("ALEGRA_ENABLED", {
    infer: true,
  });
  const enabled = rawEnabled === true || rawEnabled === "true";
  if (!enabled) return false;
  const email = configService
    .get<string>("ALEGRA_EMAIL", { infer: true })
    ?.trim();
  const token = configService
    .get<string>("ALEGRA_TOKEN", { infer: true })
    ?.trim();
  return Boolean(email && token);
}

export function getAlegraAuthHeader(
  configService: ConfigService<EnvironmentConfig>,
): string {
  const email =
    configService.get<string>("ALEGRA_EMAIL", { infer: true })?.trim() ?? "";
  const token =
    configService.get<string>("ALEGRA_TOKEN", { infer: true })?.trim() ?? "";
  const credentials = Buffer.from(`${email}:${token}`, "utf8").toString(
    "base64",
  );
  return `Basic ${credentials}`;
}

export function getAlegraTimeoutMs(
  configService: ConfigService<EnvironmentConfig>,
): number {
  const raw: unknown = configService.get("ALEGRA_TIMEOUT_MS", { infer: true });
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return ALEGRA_DEFAULT_TIMEOUT_MS;
  return Math.min(
    ALEGRA_MAX_TIMEOUT_MS,
    Math.max(ALEGRA_MIN_TIMEOUT_MS, Math.trunc(parsed)),
  );
}

export function getAlegraBaseUrl(
  configService: ConfigService<EnvironmentConfig>,
): string {
  const raw = (
    configService.get<string>("ALEGRA_API_URL", { infer: true }) ??
    ALEGRA_DEFAULT_API_URL
  )
    .trim()
    .replace(/\/+$/, "");

  const isProd =
    configService.get<string>("NODE_ENV", { infer: true }) === "production";

  try {
    const parsed = new URL(raw);
    if (parsed.username || parsed.password) {
      return ALEGRA_DEFAULT_API_URL;
    }
    const host = parsed.hostname.toLowerCase();
    if (isProd) {
      if (parsed.protocol !== "https:" || !ALEGRA_ALLOWED_API_HOSTS.has(host)) {
        return ALEGRA_DEFAULT_API_URL;
      }
      return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, "");
    }
    const isAllowedDev =
      parsed.protocol === "https:" ||
      (parsed.protocol === "http:" &&
        (host === "localhost" || host === "127.0.0.1"));
    return isAllowedDev
      ? `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, "")
      : ALEGRA_DEFAULT_API_URL;
  } catch {
    return ALEGRA_DEFAULT_API_URL;
  }
}

async function parseAlegraResponseBody<T>(res: Response): Promise<T> {
  if (res.status === 204) return {} as T;
  const text = await res.text().catch(() => "");
  if (!text.trim()) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

function getSafePathForLog(path: string): string {
  return sanitizeForLog(path.split("?")[0] || "/");
}

function isTransientRetryableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

function computeRetryDelayMs(res: Response): number {
  const retryAfter = res.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.min(2000, Math.round(seconds * 1000));
    }
  }
  return 500;
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function executeSingleAlegraFetch<T>(
  url: string,
  method: AlegraHttpMethod,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
  logger: Logger,
  safePath: string,
): Promise<{ result: AlegraDetailedResponse<T>; retryAfterMs: number | null }> {
  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
  });

  // OWASP A10: Reject unexpected 3xx redirects to prevent leaking Basic Auth credentials.
  if (res.status >= 300 && res.status < 400) {
    logger.warn(
      `Alegra API ${method} ${safePath} returned unexpected redirect (${res.status}) — blocked`,
    );
    return {
      result: { ok: false, status: res.status, data: null, errorText: null },
      retryAfterMs: null,
    };
  }

  if (method === "GET" && isTransientRetryableStatus(res.status)) {
    return {
      result: { ok: false, status: res.status, data: null, errorText: null },
      retryAfterMs: computeRetryDelayMs(res),
    };
  }

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    logger.warn(
      `Alegra API ${method} ${safePath} returned ${res.status}: ${sanitizeForLog(errorText.slice(0, 160))}`,
    );
    return {
      result: { ok: false, status: res.status, data: null, errorText },
      retryAfterMs: null,
    };
  }

  const data = await parseAlegraResponseBody<T>(res);
  return {
    result: { ok: true, status: res.status, data, errorText: null },
    retryAfterMs: null,
  };
}

function buildAlegraRequestHeaders(
  configService: ConfigService<EnvironmentConfig>,
  body: unknown,
): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: getAlegraAuthHeader(configService),
    Accept: "application/json",
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  return headers;
}

function logAlegraRequestFailure(
  logger: Logger,
  method: AlegraHttpMethod,
  safePath: string,
  timeoutMs: number,
  err: unknown,
): void {
  const isTimeout =
    err instanceof Error &&
    (err.name === "AbortError" || err.name === "TimeoutError");
  if (isTimeout) {
    logger.warn(`Alegra API ${method} ${safePath} timed out (${timeoutMs}ms)`);
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  logger.warn(
    `Alegra API ${method} ${safePath} failed: ${sanitizeForLog(message)}`,
  );
}

export async function makeAlegraDetailedRequest<T>(
  configService: ConfigService<EnvironmentConfig>,
  logger: Logger,
  method: AlegraHttpMethod,
  path: string,
  body?: unknown,
): Promise<AlegraDetailedResponse<T>> {
  if (!isAlegraConfigured(configService)) {
    logger.debug("Alegra not configured — skipping API call");
    return { ok: false, status: 0, data: null, errorText: null };
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = `${getAlegraBaseUrl(configService)}${normalizedPath}`;
  const timeoutMs = getAlegraTimeoutMs(configService);
  const safePath = getSafePathForLog(normalizedPath);
  const headers = buildAlegraRequestHeaders(configService, body);
  const maxAttempts = method === "GET" ? 2 : 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const { result, retryAfterMs } = await executeSingleAlegraFetch<T>(
        url,
        method,
        headers,
        body,
        timeoutMs,
        logger,
        safePath,
      );
      if (retryAfterMs === null) {
        return result;
      }
      if (attempt < maxAttempts) {
        logger.warn(
          `Alegra API GET ${safePath} returned ${result.status} — retrying after ${retryAfterMs}ms`,
        );
        await waitMs(retryAfterMs);
        continue;
      }
      logger.warn(
        `Alegra API ${method} ${safePath} returned ${result.status} after retry`,
      );
      return result;
    } catch (err: unknown) {
      logAlegraRequestFailure(logger, method, safePath, timeoutMs, err);
      return { ok: false, status: 0, data: null, errorText: null };
    }
  }

  return { ok: false, status: 0, data: null, errorText: null };
}

export async function makeAlegraRequest<T>(
  configService: ConfigService<EnvironmentConfig>,
  logger: Logger,
  method: AlegraHttpMethod,
  path: string,
  body?: unknown,
): Promise<T | null> {
  const res = await makeAlegraDetailedRequest<T>(
    configService,
    logger,
    method,
    path,
    body,
  );
  return res.ok ? res.data : null;
}
