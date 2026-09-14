import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { EnvironmentConfig } from "../config/config.interface";
import { sanitizeForLog } from "../common/utils/log-redact.util";
import type { VerifikRawResponse } from "./verifik.interfaces";

export async function executeVerifikFetch(
  configService: ConfigService<EnvironmentConfig>,
  logger: Logger,
  path: string,
  params: Record<string, string>,
): Promise<
  | { ok: true; response: Response; body: VerifikRawResponse }
  | {
      ok: false;
      reason: "unavailable" | "unauthorized" | "not_found" | "invalid_input";
      message: string;
    }
> {
  const token = configService.get<string>("VERIFIK_API_TOKEN");
  if (!token) {
    return {
      ok: false,
      reason: "unavailable",
      message: "El servicio de verificación Verifik no está configurado.",
    };
  }

  let baseUrl =
    configService.get<string>("VERIFIK_API_URL") ?? "https://api.verifik.co";
  while (baseUrl.endsWith("/")) {
    baseUrl = baseUrl.slice(0, -1);
  }
  const timeoutMs = configService.get<number>("VERIFIK_TIMEOUT_MS") ?? 15000;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const query = new URLSearchParams(params).toString();
    const response = await fetch(`${baseUrl}${path}?${query}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
    });

    if (response.status === 401) {
      logger.error(
        `Verifik responded 401 for ${path} — check VERIFIK_API_TOKEN`,
      );
      return {
        ok: false,
        reason: "unauthorized",
        message: "El servicio de verificación no está disponible.",
      };
    }

    let body: VerifikRawResponse;
    try {
      body = (await response.json()) as VerifikRawResponse;
    } catch {
      logger.error(
        `Verifik returned a non-JSON body (${response.status}) for ${path}`,
      );
      return {
        ok: false,
        reason: "unavailable",
        message: "El servicio de verificación no está disponible.",
      };
    }

    return { ok: true, response, body };
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      logger.warn(`Verifik request to ${path} timed out`);
    } else {
      logger.error(
        `Verifik request to ${path} failed: ${sanitizeForLog(
          err instanceof Error ? err.message : String(err),
        )}`,
      );
    }
    return {
      ok: false,
      reason: "unavailable",
      message: "El servicio de verificación no está disponible.",
    };
  } finally {
    clearTimeout(timeout);
  }
}
