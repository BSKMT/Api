import { Logger } from "@nestjs/common";

export interface SealedValue<T> {
  v: T;
  h: string;
}

export class KvCircuitBreaker {
  private failures = 0;
  private openUntil = 0;

  constructor(
    private readonly threshold = 5,
    private readonly cooldownMs = 30000,
    private readonly logger?: Logger,
  ) {}

  isOpen(): boolean {
    if (this.failures < this.threshold) return false;
    if (Date.now() > this.openUntil) {
      this.failures = 0;
      return false;
    }
    return true;
  }

  recordSuccess(): void {
    this.failures = 0;
  }

  recordFailure(): void {
    this.failures++;
    if (this.failures >= this.threshold) {
      this.openUntil = Date.now() + this.cooldownMs;
      this.logger?.warn(
        `KV circuit breaker tripped after ${this.failures} consecutive failures. Cooldown: ${this.cooldownMs}ms.`,
      );
    }
  }
}

export class KvHmacHelper {
  private hmacKey: CryptoKey | null = null;

  constructor(private readonly secret: string) {}

  private async getHmacKey(): Promise<CryptoKey> {
    if (this.hmacKey) return this.hmacKey;
    this.hmacKey = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(this.secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    return this.hmacKey;
  }

  async computeTag(payload: string): Promise<string> {
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
      .replace(/={1,2}$/, "");
  }
}
