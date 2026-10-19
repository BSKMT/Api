import { Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";

/**
 * CloudflareThrottlerGuard — Extiende ThrottlerGuard para extraer la IP real
 * del cliente desde la cabecera `cf-connecting-ip` inyectada por Cloudflare Edge,
 * evitando tanto el bloqueo global por IP compartida de Cloudflare/Workers como
 * la falsificación de saltos en `X-Forwarded-For` (VULN-17).
 */
@Injectable()
export class CloudflareThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(req: Record<string, unknown>): Promise<string> {
    const headers = (req.headers ?? {}) as Record<
      string,
      string | string[] | undefined
    >;
    const cfIpRaw = headers["cf-connecting-ip"];
    const cfIp = Array.isArray(cfIpRaw) ? cfIpRaw[0] : cfIpRaw;
    if (typeof cfIp === "string" && cfIp.trim().length > 0) {
      return Promise.resolve(cfIp.trim());
    }

    const realIpRaw = headers["x-real-ip"];
    const realIp = Array.isArray(realIpRaw) ? realIpRaw[0] : realIpRaw;
    if (typeof realIp === "string" && realIp.trim().length > 0) {
      return Promise.resolve(realIp.trim());
    }

    const ip =
      typeof req.ip === "string" && req.ip.length > 0 ? req.ip : "unknown";
    return Promise.resolve(ip);
  }
}
