/**
 * Cloudflare Workers KV cache service for the BSK Motorcycle Team API.
 *
 * Provides a NestJS-compatible service that wraps the official Cloudflare SDK
 * to read/write cached data via the KV REST API.
 */

import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { EnvironmentConfig } from "../config/config.interface";
import {
  KvCircuitBreaker,
  KvHmacHelper,
  type SealedValue,
} from "./kv-cache.helpers";

@Injectable()
export class KvCacheService {
  private readonly logger = new Logger(KvCacheService.name);
  private readonly enabled: boolean;
  private readonly accountId: string;
  private readonly publicNsId: string;
  private readonly privateNsId: string;
  private readonly apiToken: string;
  private readonly baseUrl: string;

  private readonly breaker: KvCircuitBreaker;
  private readonly hmac: KvHmacHelper;

  constructor(
    private readonly configService: ConfigService<EnvironmentConfig>,
  ) {
    this.enabled = process.env.CF_KV_ENABLED === "true";
    this.accountId = process.env.CF_ACCOUNT_ID ?? "";
    this.publicNsId = process.env.CF_KV_NAMESPACE_ID_PUBLIC ?? "";
    this.privateNsId = process.env.CF_KV_NAMESPACE_ID_PRIVATE ?? "";
    this.apiToken = process.env.CF_KV_API_TOKEN ?? "";
    this.baseUrl = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/storage/kv/namespaces`;

    this.breaker = new KvCircuitBreaker(5, 30000, this.logger);
    this.hmac = new KvHmacHelper(process.env.BETTER_AUTH_SECRET ?? "");
  }

  isAvailable(): boolean {
    return this.enabled && !this.breaker.isOpen();
  }

  private getNamespaceId(isPrivate: boolean): string {
    return isPrivate ? this.privateNsId : this.publicNsId;
  }

  async get<T>(key: string, isPrivate = false): Promise<T | null> {
    if (!this.enabled || this.breaker.isOpen()) return null;
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
        this.breaker.recordSuccess();
        return null;
      }
      if (!res.ok) {
        this.breaker.recordFailure();
        return null;
      }

      const text = await res.text();
      const sealed = JSON.parse(text) as SealedValue<T>;
      if (!sealed || typeof sealed.h !== "string" || sealed.v === undefined) {
        return null;
      }

      const expectedTag = await this.hmac.computeTag(JSON.stringify(sealed.v));
      if (sealed.h !== expectedTag) {
        this.logger.warn(`KV integrity check failed for key: ${key}`);
        return null;
      }

      this.breaker.recordSuccess();
      return sealed.v;
    } catch {
      this.breaker.recordFailure();
      return null;
    }
  }

  async set<T>(
    key: string,
    value: T,
    ttlSeconds: number,
    isPrivate = false,
  ): Promise<void> {
    if (!this.enabled || this.breaker.isOpen()) return;
    const nsId = this.getNamespaceId(isPrivate);
    if (!nsId) return;

    try {
      const tag = await this.hmac.computeTag(JSON.stringify(value));
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
        this.breaker.recordSuccess();
      } else {
        this.breaker.recordFailure();
      }
    } catch {
      this.breaker.recordFailure();
    }
  }

  async delete(key: string, isPrivate = false): Promise<void> {
    if (!this.enabled || this.breaker.isOpen()) return;
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
        this.breaker.recordSuccess();
      } else {
        this.breaker.recordFailure();
      }
    } catch {
      this.breaker.recordFailure();
    }
  }

  async invalidatePrefix(prefix: string, isPrivate = false): Promise<void> {
    if (!this.enabled || this.breaker.isOpen()) return;
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
        this.breaker.recordFailure();
        return;
      }

      const data = (await res.json()) as {
        result: { name: string }[];
        result_info: { count: number };
      };
      const keys = (data.result ?? []).map((k) => k.name);
      if (keys.length === 0) {
        this.breaker.recordSuccess();
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
        this.breaker.recordSuccess();
      } else {
        this.breaker.recordFailure();
      }
    } catch {
      this.breaker.recordFailure();
    }
  }
}
