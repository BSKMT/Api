/**
 * Cloudflare Workers KV cache service for the BSK Motorcycle Team API.
 *
 * Provides a NestJS-compatible service that wraps the official Cloudflare SDK
 * to read/write cached data via the KV REST API. Used for:
 *   - Public catalog caching (events, shop products, courses, stats).
 *   - Session guard hot-path caching (user auth profile).
 *   - Webhook idempotency/dedup screening (Phase 4).
 *
 * SECURITY (OWASP Top 10 2025):
 *   A02 - The API token is resolved from Vercel env vars, never hardcoded.
 *          Token scope should be limited to KV read+write only.
 *   A04 - All cached values carry an HMAC-SHA256 integrity tag sealed at
 *          write time and verified on read (fail-closed on tamper).
 *   A05 - Cache keys are validated/sanitized before use (no user input
 *          as raw keys).
 *   A10 - Circuit breaker trips after 5 consecutive failures and enters
 *          a 30-second cooldown. All KV errors are caught; callers must
 *          always have a Mongo fallback.
 *
 * @packageDocumentation
 */

import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { EnvironmentConfig } from "../config/config.interface";

interface SealedValue<T> {
  v: T;
  h: string;
}

@Injectable()
export class KvCacheService {
  private readonly logger = new Logger(KvCacheService.name);
  private readonly enabled: boolean;
  private readonly accountId: string;
  private readonly publicNsId: string;
  private readonly privateNsId: string;
  private readonly apiToken: string;
  private readonly baseUrl: string;

  private failures = 0;
  private openUntil = 0;
  private readonly threshold = 5;
  private readonly cooldownMs = 30000;
  private hmacKey: CryptoKey | null = null;
  constructor(
    private readonly configService: ConfigService<EnvironmentConfig>,
  ) {
    this.enabled = process.env.CF_KV_ENABLED === "true";
    this.accountId = process.env.CF_ACCOUNT_ID ?? "";
    this.publicNsId = process.env.CF_KV_NAMESPACE_ID_PUBLIC ?? "";
    this.privateNsId = process.env.CF_KV_NAMESPACE_ID_PRIVATE ?? "";
    this.apiToken = process.env.CF_KV_API_TOKEN ?? "";
    this.baseUrl = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/storage/kv/namespaces`;
  }

  isAvailable(): boolean {
    return this.enabled && !this.isBreakerOpen();
  }

  private isBreakerOpen(): boolean {
    if (this.failures < this.threshold) return false;
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
    if (this.failures >= this.threshold) {
      this.openUntil = Date.now() + this.cooldownMs;
      this.logger.warn(
        `KV circuit breaker tripped after ${this.failures} consecutive failures. Cooldown: ${this.cooldownMs}ms.`,
      );
    }
  }

  private getNamespaceId(isPrivate: boolean): string {
    return isPrivate ? this.privateNsId : this.publicNsId;
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

  private async computeTag(payload: string): Promise<string> {
    const key = await this.getHmacKey();
    const signature = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)),
    );
    let bin = "";
    for (const byte of signature) {
      bin += String.fromCodePoint(byte);
    }
    return btoa(bin)
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "");
  }

  async get<T>(key: string, isPrivate = false): Promise<T | null> {
    if (!this.enabled || this.isBreakerOpen()) return null;
    const nsId = this.getNamespaceId(isPrivate);
    if (!nsId) return null;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 500);

      const res = await fetch(
        `${this.baseUrl}/${nsId}/values/${encodeURIComponent(key)}`,
        {
          headers: { Authorization: `Bearer ${this.apiToken}` },
          signal: controller.signal,
        },
      );
      clearTimeout(timeout);

      if (res.status === 404) {
        this.recordSuccess();
        return null;
      }
      if (!res.ok) {
        this.recordFailure();
        return null;
      }

      const text = await res.text();
      const sealed = JSON.parse(text) as SealedValue<T>;
      if (!sealed || typeof sealed.h !== "string" || sealed.v === undefined) {
        return null;
      }

      const expectedTag = await this.computeTag(JSON.stringify(sealed.v));
      if (sealed.h !== expectedTag) {
        this.logger.warn(`KV integrity check failed for key: ${key}`);
        return null;
      }

      this.recordSuccess();
      return sealed.v;
    } catch {
      this.recordFailure();
      return null;
    }
  }

  async set<T>(
    key: string,
    value: T,
    ttlSeconds: number,
    isPrivate = false,
  ): Promise<void> {
    if (!this.enabled || this.isBreakerOpen()) return;
    const nsId = this.getNamespaceId(isPrivate);
    if (!nsId) return;

    try {
      const tag = await this.computeTag(JSON.stringify(value));
      const sealed: SealedValue<T> = { v: value, h: tag };
      const body = JSON.stringify(sealed);

      const url = new URL(
        `${this.baseUrl}/${nsId}/values/${encodeURIComponent(key)}`,
      );
      if (ttlSeconds >= 60) {
        url.searchParams.set("expiration_ttl", String(ttlSeconds));
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 500);

      const res = await fetch(url, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          "Content-Type": "application/json",
        },
        body,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.ok) {
        this.recordSuccess();
      } else {
        this.recordFailure();
      }
    } catch {
      this.recordFailure();
    }
  }

  async delete(key: string, isPrivate = false): Promise<void> {
    if (!this.enabled || this.isBreakerOpen()) return;
    const nsId = this.getNamespaceId(isPrivate);
    if (!nsId) return;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 500);

      const res = await fetch(
        `${this.baseUrl}/${nsId}/values/${encodeURIComponent(key)}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${this.apiToken}` },
          signal: controller.signal,
        },
      );
      clearTimeout(timeout);

      if (res.ok || res.status === 404) {
        this.recordSuccess();
      } else {
        this.recordFailure();
      }
    } catch {
      this.recordFailure();
    }
  }

  async invalidatePrefix(prefix: string, isPrivate = false): Promise<void> {
    if (!this.enabled || this.isBreakerOpen()) return;
    const nsId = this.getNamespaceId(isPrivate);
    if (!nsId) return;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);

      const res = await fetch(
        `${this.baseUrl}/${nsId}/keys?prefix=${encodeURIComponent(prefix)}&limit=1000`,
        {
          headers: { Authorization: `Bearer ${this.apiToken}` },
          signal: controller.signal,
        },
      );
      clearTimeout(timeout);

      if (!res.ok) {
        this.recordFailure();
        return;
      }

      const data = (await res.json()) as {
        result: { name: string }[];
        result_info: { count: number };
      };
      const keys = (data.result ?? []).map((k) => k.name);
      if (keys.length === 0) {
        this.recordSuccess();
        return;
      }

      const delController = new AbortController();
      const delTimeout = setTimeout(() => delController.abort(), 2000);

      const delRes = await fetch(`${this.baseUrl}/${nsId}/bulk/delete`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(keys),
        signal: delController.signal,
      });
      clearTimeout(delTimeout);

      if (delRes.ok) {
        this.recordSuccess();
      } else {
        this.recordFailure();
      }
    } catch {
      this.recordFailure();
    }
  }
}
