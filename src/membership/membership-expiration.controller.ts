import {
  Controller,
  Post,
  Headers,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { EnvironmentConfig } from "../config/config.interface";
import { MembershipExpirationService } from "./services/membership-expiration.service";

/**
 * MembershipExpirationController — HTTP entry point for Vercel Cron.
 *
 * Background: NestJS `@Cron` decorators rely on a long-lived process.
 * On Vercel serverless the function instance is frozen between
 * invocations so `@Cron` callbacks never fire — expired members kept
 * `MEMBER` role and benefits indefinitely (A-7). This controller exposes
 * an HTTP route that Vercel Cron hits on a fixed schedule.
 *
 * Security: requests must include
 *   `X-Cron-Secret: <CRON_SECRET>`
 * matching the Vercel env var; otherwise the route 400s. The route is
 * declared outside the throttler's default scope (Vercel uses HTTP
 * signing but the secret is a defense-in-depth) and is intentionally
 * not authenticated via SessionGuard (no human user calls it).
 *
 * Vercel Cron sends the configured secret via the `Authorization: Bearer
 * <secret>` header automatically. We accept either `X-Cron-Secret`
 * (legacy/explicit) or the `Bearer` token from `Authorization` so the
 * endpoint remains portable.
 */
@Controller("internal/cron")
export class MembershipExpirationController {
  private readonly logger = new Logger(MembershipExpirationController.name);

  constructor(
    private readonly expirationService: MembershipExpirationService,
    private readonly configService: ConfigService<EnvironmentConfig>,
  ) {}

  @Post("membership-expiration")
  @HttpCode(HttpStatus.OK)
  async runMembershipExpiration(
    @Headers("x-cron-secret") headerSecret: string | undefined,
    @Headers("authorization") authorization: string | undefined,
  ) {
    this.assertSecret(headerSecret, authorization);
    const startedAt = Date.now();
    await this.expirationService.handleMembershipExpiration();
    const elapsed = Date.now() - startedAt;
    this.logger.log(
      `membership-expiration cron completed in ${elapsed}ms`,
    );
    return { ok: true, elapsedMs: elapsed };
  }

  /**
   * Defense-in-depth secret check. Accepts either the dedicated
   * `X-Cron-Secret` header (explicit) or the Vercel-Cron-default
   * `Authorization: Bearer <secret>` header. The constant-time compare
   * prevents header-based timing side channels.
   */
  private assertSecret(
    headerSecret: string | undefined,
    authorization: string | undefined,
  ): void {
    const expected =
      this.configService.get<string>("CRON_SECRET", { infer: true }) ?? "";
    if (!expected) {
      throw new BadRequestException("CRON_SECRET not configured");
    }
    const provided =
      headerSecret ??
      (authorization && authorization.startsWith("Bearer ")
        ? authorization.slice("Bearer ".length)
        : undefined) ??
      "";
    if (provided.length !== expected.length || provided !== expected) {
      this.logger.warn(
        "Unauthorized cron invocation — secret mismatch (or missing).",
      );
      throw new BadRequestException("Invalid or missing cron secret");
    }
  }
}