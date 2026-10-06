import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { getMongoDb } from "../auth/better-auth";
import { maskPhone, sanitizeForLog } from "../common/utils/log-redact.util";
import { ObjectId } from "mongodb";
import type { KvCacheService } from "../kv/kv-cache.service";

export class ChannelThrottleStore {
  private readonly store = new Map<string, number[]>();

  constructor(
    private readonly windowMs = 5 * 60 * 1000,
    private readonly maxSends = 3,
    private readonly kvCache?: KvCacheService,
  ) {}

  async enforce(key: string, logger?: Logger): Promise<void> {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    let timestamps: number[] = [];

    if (this.kvCache?.isAvailable()) {
      try {
        const cached = await this.kvCache.get<number[]>(
          `throttle:${key}`,
          true,
        );
        if (Array.isArray(cached)) {
          timestamps = cached.filter(
            (t) => typeof t === "number" && t > cutoff,
          );
        }
      } catch {
        timestamps = (this.store.get(key) ?? []).filter((t) => t > cutoff);
      }
    } else {
      timestamps = (this.store.get(key) ?? []).filter((t) => t > cutoff);
    }

    if (timestamps.length >= this.maxSends) {
      logger?.warn(
        `Throttle: ${maskPhone(key)} exceeded ${this.maxSends} sends in ${this.windowMs / 1000}s`,
      );
      throw new HttpException(
        "Has solicitado demasiados codigos. Espera 5 minutos e intenta de nuevo.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async record(key: string): Promise<void> {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const timestamps = (this.store.get(key) ?? []).filter((t) => t > cutoff);
    timestamps.push(now);
    this.store.set(key, timestamps);

    if (this.kvCache?.isAvailable()) {
      try {
        const ttlSec = Math.ceil(this.windowMs / 1000);
        await this.kvCache.set(`throttle:${key}`, timestamps, ttlSec, true);
      } catch {
        // Fallback local silencioso
      }
    }
  }
}

export function handleVerifyCheckResult(
  result: {
    success: boolean;
    reason?: string | null;
    attemptsRemaining?: number | null;
  },
  onExhausted: () => Promise<void> | void,
) {
  if (!result.success) {
    if (result.reason === "expired" || result.reason === "attempts_exhausted") {
      void onExhausted();
      throw new HttpException(
        "El codigo ha expirado o se agotaron los intentos. Solicita uno nuevo.",
        HttpStatus.GONE,
      );
    }
    throw new BadRequestException(
      `Codigo incorrecto. Intentos restantes: ${result.attemptsRemaining}`,
    );
  }
}

export async function updateBetterAuthEmail(
  betterAuthId: string,
  normalizedEmail: string,
  logger: Logger,
): Promise<void> {
  try {
    const db = getMongoDb();
    const idFilters: Record<string, unknown>[] = [{ id: betterAuthId }];
    if (betterAuthId && ObjectId.isValid(betterAuthId)) {
      idFilters.push({ _id: new ObjectId(betterAuthId) });
    }
    await db.collection("user").updateOne(
      { $or: idFilters },
      {
        $set: {
          email: normalizedEmail,
          emailVerified: true,
          updatedAt: new Date(),
        },
      },
    );
  } catch (err: unknown) {
    logger.error(
      `verifyEmailChange: Failed to update Better Auth user: ${sanitizeForLog(
        err instanceof Error ? err.message : String(err),
      )}`,
    );
    throw new BadRequestException(
      "No se pudo actualizar el correo. Intenta de nuevo.",
    );
  }
}
