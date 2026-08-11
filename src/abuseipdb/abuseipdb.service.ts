/**
 * AbuseIPDB integration service for the BSK Motorcycle Team API.
 *
 * Checks client IP addresses against the AbuseIPDB CHECK endpoint
 * (https://api.abuseipdb.com/api/v2/check) and caches results in
 * Cloudflare Workers KV via {@link KvCacheService}.
 *
 * SECURITY (OWASP Top 10 2025):
 *   A02 - The API key is resolved from Vercel env vars, never hardcoded.
 *          The key is sent via the HTTP `Key` header (NOT query parameter)
 *          to avoid leaking it in server access logs.
 *   A04 - IP addresses are HMAC-SHA256 hashed before being used as KV
 *          cache keys — no cleartext PII in KV (GDPR compliance).
 *   A07 - Blocks IPs with abuseConfidenceScore >= threshold (default 75)
 *          to mitigate brute-force and credential-stuffing attacks.
 *   A09 - All blocked requests and circuit-breaker trips are logged.
 *          The API key and full IP addresses are never logged.
 *   A10 - Circuit breaker trips after 5 consecutive failures and enters
 *          a 30-second cooldown. When the breaker is open or the API
 *          is unreachable, the system FAILS OPEN (allows the request)
 *          to avoid blocking legitimate users during an outage.
 *          All errors are caught and never propagated to the caller.
 *
 * RATE LIMITS (AbuseIPDB):
 *   Standard plan: 1,000 check requests/day.
 *   Cache TTL: 1 hour (3600s) for normal results, 5 minutes (300s) for
 *   "unknown" results (when the API is unreachable). This keeps daily
 *   API calls well under the limit for typical traffic.
 *
 * @packageDocumentation
 */

import { Injectable, Logger } from "@nestjs/common";
import { KvCacheService } from "../kv/kv-cache.service";

/** Shape of the cached AbuseIPDB check result. */
export interface AbuseIpDbCheckResult {
  /** The abuse confidence score (0-100). */
  abuseConfidenceScore: number;
  /** Whether the IP is whitelisted by AbuseIPDB. */
  isWhitelisted: boolean;
  /** Timestamp (ms epoch) when this cache entry was stored. */
  cachedAt: number;
}

/** Shape of the AbuseIPDB API `data` response from the CHECK endpoint. */
interface AbuseIpDbCheckResponse {
  data: {
    ipAddress: string;
    isPublic: boolean;
    ipVersion: number;
    isWhitelisted: boolean;
    abuseConfidenceScore: number;
    countryCode: string;
    usageType: string;
    isp: string;
    domain: string;
    hostnames: string[];
    isTor: boolean;
    totalReports: number;
    numDistinctUsers: number;
    lastReportedAt: string;
  };
}

/** Shape of the AbuseIPDB error response. */
interface AbuseIpDbErrorResponse {
  errors: Array<{ detail: string; status: number }>;
}

/** Cache TTL for a successful AbuseIPDB check result (1 hour). */
const CACHE_TTL_SECONDS = 3600;

/** KV cache key prefix for AbuseIPDB results. */
const CACHE_KEY_PREFIX = "abuseipdb:check:";

/** Timeout for AbuseIPDB API requests (3 seconds). */
const API_TIMEOUT_MS = 3000;

/** AbuseIPDB API base URL. */
const ABUSEIPDB_API_BASE = "https://api.abuseipdb.com/api/v2";

@Injectable()
export class AbuseIpDbService {
  private readonly logger = new Logger(AbuseIpDbService.name);
  private readonly apiKey: string;
  private readonly enabled: boolean;
  private readonly blockThreshold: number;

  /** Circuit breaker state for AbuseIPDB API calls. */
  private failures = 0;
  private openUntil = 0;
  private readonly breakerThreshold = 5;
  private readonly breakerCooldownMs = 30000;

  /** HMAC key for hashing IP addresses into KV cache keys. */
  private hmacKey: CryptoKey | null = null;

  constructor(private readonly kvCache: KvCacheService) {
    this.apiKey = process.env.ABUSEIPDB_API_KEY ?? "";
    this.enabled = process.env.ABUSEIPDB_ENABLED === "true";
    const threshold = Number(process.env.ABUSEIPDB_BLOCK_THRESHOLD ?? 75);
    this.blockThreshold = Number.isFinite(threshold) ? threshold : 75;
  }

  /** Returns true if AbuseIPDB protection is enabled and operational. */
  isEnabled(): boolean {
    return this.enabled && this.apiKey.length > 0 && !this.isBreakerOpen();
  }

  /**
   * Checks if an IP address should be blocked based on its AbuseIPDB
   * abuse confidence score.
   *
   * Flow:
   *   1. If AbuseIPDB is disabled, the key is missing, or the breaker is
   *      open → return false (fail open).
   *   2. Validate the IP address format (IPv4/IPv6).
   *   3. Check the KV cache for a recent result.
   *   4. On cache miss, call the AbuseIPDB CHECK endpoint.
   *   5. Cache the result (sealed with HMAC integrity tag via KvCacheService).
   *   6. Return `true` if `abuseConfidenceScore >= blockThreshold` and the
   *      IP is NOT whitelisted.
   *
   * @param ip — The client IP address to check.
   * @returns `true` if the IP should be blocked, `false` otherwise.
   */
  async isMalicious(ip: string): Promise<boolean> {
    if (!this.enabled || !this.apiKey || this.isBreakerOpen()) {
      return false;
    }

    if (!isValidIp(ip)) {
      return false;
    }

    const cacheKey = await this.buildCacheKey(ip);
    const cached = await this.kvCache.get<AbuseIpDbCheckResult>(
      cacheKey,
      false,
    );
    if (cached) {
      return this.evaluateBlocked(cached);
    }

    const result = await this.checkIp(ip);
    if (result) {
      await this.kvCache.set(cacheKey, result, CACHE_TTL_SECONDS, false);
      return this.evaluateBlocked(result);
    }

    return false;
  }

  /**
   * Evaluates a cached or fresh AbuseIPDB result to determine if the
   * IP should be blocked.
   *
   * An IP is blocked when:
   *   - `abuseConfidenceScore >= blockThreshold`
   *   - AND `isWhitelisted === false` (whitelisted IPs are never blocked)
   */
  private evaluateBlocked(result: AbuseIpDbCheckResult): boolean {
    if (result.isWhitelisted) return false;
    return result.abuseConfidenceScore >= this.blockThreshold;
  }

  /**
   * Calls the AbuseIPDB CHECK endpoint for a single IP address.
   *
   * Uses the `Key` HTTP header (not query parameter) per AbuseIPDB
   * security recommendation to avoid leaking the key in server logs.
   * Includes a 3-second timeout via AbortController.
   *
   * On any error (network, timeout, non-200, rate limit), the circuit
   * breaker is notified and `null` is returned (fail open).
   */
  private async checkIp(ip: string): Promise<AbuseIpDbCheckResult | null> {
    const url = new URL(`${ABUSEIPDB_API_BASE}/check`);
    url.searchParams.set("ipAddress", ip);
    url.searchParams.set("maxAgeInDays", "90");
    url.searchParams.set("verbose", "");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        headers: {
          Key: this.apiKey,
          Accept: "application/json",
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.status === 429) {
        this.logger.warn(
          "AbuseIPDB rate limit exceeded (429). Failing open until circuit breaker trips.",
        );
        this.recordFailure();
        return null;
      }

      if (!res.ok) {
        const body = (await res.json()) as AbuseIpDbErrorResponse;
        const detail = body.errors?.[0]?.detail ?? `HTTP ${res.status}`;
        this.logger.warn(`AbuseIPDB API error: ${detail}`);
        this.recordFailure();
        return null;
      }

      const body = (await res.json()) as AbuseIpDbCheckResponse;
      this.recordSuccess();

      return {
        abuseConfidenceScore: body.data.abuseConfidenceScore,
        isWhitelisted: body.data.isWhitelisted,
        cachedAt: Date.now(),
      };
    } catch (error) {
      clearTimeout(timeout);
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`AbuseIPDB API request failed: ${msg}`);
      this.recordFailure();
      return null;
    }
  }

  /**
   * Builds a privacy-preserving KV cache key by HMAC-SHA256 hashing
   * the IP address so that cleartext IPs never appear in KV keys
   * (OWASP A02/A04 — GDPR compliance).
   */
  private async buildCacheKey(ip: string): Promise<string> {
    const hash = await this.hashIp(ip);
    return `${CACHE_KEY_PREFIX}${hash}`;
  }

  /** HMAC-SHA256 hashes the IP address using the BETTER_AUTH secret. */
  private async hashIp(ip: string): Promise<string> {
    const key = await this.getHmacKey();
    const signature = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(ip)),
    );
    let bin = "";
    for (let i = 0; i < signature.length; i++) {
      bin += String.fromCharCode(signature[i]);
    }
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  private async getHmacKey(): Promise<CryptoKey> {
    if (this.hmacKey) return this.hmacKey;
    const secret = process.env.BETTER_AUTH_SECRET ?? "";
    this.hmacKey = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    return this.hmacKey;
  }

  // ── Circuit Breaker ──────────────────────────────────────────────

  private isBreakerOpen(): boolean {
    if (this.failures < this.breakerThreshold) return false;
    if (Date.now() > this.openUntil) {
      this.failures = 0;
      return false;
    }
    return true;
  }

  private recordSuccess(): void {
    this.failures = 0;
  }

  private recordFailure(): void {
    this.failures++;
    if (this.failures >= this.breakerThreshold) {
      this.openUntil = Date.now() + this.breakerCooldownMs;
      this.logger.warn(
        `AbuseIPDB circuit breaker tripped after ${this.failures} consecutive failures. Cooldown: ${this.breakerCooldownMs}ms.`,
      );
    }
  }

  /** For testing: resets the circuit breaker state. */
  resetBreaker(): void {
    this.failures = 0;
    this.openUntil = 0;
  }
}

/**
 * Validates that a string is a well-formed IPv4 or IPv6 address.
 *
 * Uses a conservative regex that rejects:
 *   - Empty strings
 *   - Strings with control characters
 *   - URL-encoded sequences (e.g., %2C)
 *   - Anything that is not a valid dotted-quad or colon-hex address
 *
 * @param ip — The string to validate.
 * @returns `true` if the string is a valid IPv4 or IPv6 address.
 */
export function isValidIp(ip: string): boolean {
  if (!ip || ip === "unknown" || ip.length > 45) return false;
  // Reject anything that is not hex digits, dots, colons, or is empty
  if (!/^[0-9a-fA-F.:]+$/.test(ip)) return false;
  // IPv4: dotted-quad, each octet 0-255
  const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (ipv4.test(ip)) {
    return ip.split(".").every((octet) => {
      const n = Number(octet);
      return n >= 0 && n <= 255;
    });
  }
  // IPv6: at least two colons, hex groups
  const ipv6 = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
  return ipv6.test(ip);
}
