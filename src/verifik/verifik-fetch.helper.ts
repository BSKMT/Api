import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { EnvironmentConfig } from "../config/config.interface";
import { sanitizeForLog } from "../common/utils/log-redact.util";
import type { VerifikRawResponse } from "./verifik.interfaces";

export const MAX_VERIFIK_RESPONSE_BYTES = 1_048_576; // 1 MiB cap against memory DoS

export type VerifikFailureReason =
  "unavailable" | "unauthorized" | "not_found" | "invalid_input";

export function normalizeVerifikBearerToken(
  rawToken: string | undefined,
): string | null {
  if (!rawToken) return null;
  let token = rawToken.trim();
  if (/^bearer\s+/i.test(token)) {
    token = token.replace(/^bearer\s+/i, "").trim();
  } else if (/^jwt\s+/i.test(token)) {
    token = token.replace(/^jwt\s+/i, "").trim();
  }
  if (!token || /\s/.test(token)) {
    return null;
  }
  return token;
}

export function validateVerifikBaseUrl(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  const isOfficialVerifikHost =
    host === "api.verifik.co" ||
    host === "verifik.app" ||
    host.endsWith(".verifik.co");
  const isTestLoopback =
    process.env.NODE_ENV === "test" &&
    (host === "localhost" || host === "127.0.0.1");

  if (!isOfficialVerifikHost && !isTestLoopback) {
    return null;
  }
  if (!isTestLoopback && parsed.protocol !== "https:") {
    return null;
  }

  let normalized = parsed.origin + parsed.pathname;
  while (normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

export function isVerifikOutOfService409(body: VerifikRawResponse): boolean {
  const code = typeof body.code === "string" ? body.code.toLowerCase() : "";
  const msg =
    typeof body.message === "string" ? body.message.toLowerCase() : "";
  return (
    code === "conflict" ||
    code === "endpoint_out_of_service" ||
    msg.includes("endpoint_out_of_service") ||
    msg.includes("out_of_service") ||
    msg.includes("unable to resolve") ||
    msg.includes("temporarily unavailable")
  );
}

export function extractVerifikRawError(body: VerifikRawResponse): string {
  if (typeof body.message === "string" && body.message.trim()) {
    return body.message.trim();
  }
  if (typeof body.error === "string" && body.error.trim()) {
    return body.error.trim();
  }
  if (typeof body.code === "string" && body.code.trim()) {
    return body.code.trim();
  }
  return "unknown";
}

async function readBoundedJsonBody(
  response: Response,
  logger: Logger,
  path: string,
): Promise<VerifikRawResponse | null> {
  const contentLengthHeader = response.headers.get("content-length");
  if (contentLengthHeader) {
    const declaredBytes = Number(contentLengthHeader);
    if (
      Number.isFinite(declaredBytes) &&
      declaredBytes > MAX_VERIFIK_RESPONSE_BYTES
    ) {
      logger.error(
        `Verifik response for ${path} exceeded size cap (${declaredBytes} bytes)`,
      );
      return null;
    }
  }

  const rawText = await response.text();
  if (Buffer.byteLength(rawText, "utf8") > MAX_VERIFIK_RESPONSE_BYTES) {
    logger.error(
      `Verifik response body for ${path} exceeded ${MAX_VERIFIK_RESPONSE_BYTES} bytes`,
    );
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(rawText);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    logger.error(
      `Verifik returned a non-JSON body (${response.status}) for ${path}`,
    );
    return null;
  }
}

type VerifikFetchFailure = {
  ok: false;
  reason: VerifikFailureReason;
  message: string;
};

type VerifikFetchResult =
  | { ok: true; response: Response; body: VerifikRawResponse }
  | VerifikFetchFailure;

const SERVICE_UNAVAILABLE_FAILURE: VerifikFetchFailure = {
  ok: false,
  reason: "unavailable",
  message: "El servicio de verificación no está disponible.",
};

function resolveVerifikRequestContext(
  configService: ConfigService<EnvironmentConfig>,
  logger: Logger,
): { ok: true; token: string; baseUrl: string } | VerifikFetchFailure {
  const token = normalizeVerifikBearerToken(
    configService.get<string>("VERIFIK_API_TOKEN"),
  );
  if (!token) {
    return {
      ok: false,
      reason: "unavailable",
      message: "El servicio de verificación Verifik no está configurado.",
    };
  }

  const configuredUrl =
    configService.get<string>("VERIFIK_API_URL") ?? "https://api.verifik.co";
  const baseUrl = validateVerifikBaseUrl(configuredUrl);
  if (!baseUrl) {
    logger.error("Verifik request blocked: VERIFIK_API_URL failed allowlist");
    return SERVICE_UNAVAILABLE_FAILURE;
  }

  return { ok: true, token, baseUrl };
}

function classifyVerifikHttpFailure(
  response: Response,
  logger: Logger,
  path: string,
): VerifikFetchFailure | null {
  if (response.status >= 300 && response.status < 400) {
    logger.error(
      `Verifik responded with redirect (${response.status}) for ${path} — blocked to protect Bearer token`,
    );
    return SERVICE_UNAVAILABLE_FAILURE;
  }

  if (response.status === 401 || response.status === 403) {
    const hint =
      response.status === 401
        ? "check VERIFIK_API_TOKEN (Verifik JWT expires every 30 days)"
        : "check Verifik plan permissions or account credits";
    logger.error(`Verifik responded ${response.status} for ${path} — ${hint}`);
    return {
      ok: false,
      reason: "unauthorized",
      message: "El servicio de verificación no está disponible.",
    };
  }

  return null;
}

function logVerifikFetchError(
  err: unknown,
  logger: Logger,
  path: string,
): void {
  if (err instanceof Error && err.name === "AbortError") {
    logger.warn(`Verifik request to ${path} timed out`);
    return;
  }
  const detail = err instanceof Error ? err.message : String(err);
  logger.error(`Verifik request to ${path} failed: ${sanitizeForLog(detail)}`);
}

export async function executeVerifikFetch(
  configService: ConfigService<EnvironmentConfig>,
  logger: Logger,
  path: string,
  params: Record<string, string>,
): Promise<VerifikFetchResult> {
  const ctx = resolveVerifikRequestContext(configService, logger);
  if (!ctx.ok) {
    return ctx;
  }

  const timeoutMs = configService.get<number>("VERIFIK_TIMEOUT_MS") ?? 15000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const query = new URLSearchParams(params).toString();
    const targetUrl = query
      ? `${ctx.baseUrl}${path}?${query}`
      : `${ctx.baseUrl}${path}`;
    const response = await fetch(targetUrl, {
      method: "GET",
      redirect: "manual",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${ctx.token}`,
      },
      signal: controller.signal,
    });

    const httpFailure = classifyVerifikHttpFailure(response, logger, path);
    if (httpFailure) {
      return httpFailure;
    }

    const body = await readBoundedJsonBody(response, logger, path);
    if (!body) {
      return SERVICE_UNAVAILABLE_FAILURE;
    }

    return { ok: true, response, body };
  } catch (err: unknown) {
    logVerifikFetchError(err, logger, path);
    return SERVICE_UNAVAILABLE_FAILURE;
  } finally {
    clearTimeout(timeout);
  }
}
