import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Headers,
  UnauthorizedException,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { Public } from "../common/decorators";
import { SessionGuard } from "../auth/session.guard";
import { IdentityVerifiedGuard } from "../common/guards";
import { UsersService } from "../users/users.service";
import { ShopService } from "./shop.service";
import { CreateOrderDto } from "./dto/create-order.dto";
import { AddWishlistDto } from "./dto/add-wishlist.dto";
import { ensureString } from "../common/utils/sanitize-query.util";
import type { EnvironmentConfig } from "../config/config.interface";

interface AuthenticatedRequest extends Request {
  user: { userId: string; email?: string };
}

@Controller("shop")
export class ShopController {
  private readonly logger = new Logger(ShopController.name);

  constructor(
    private readonly shopService: ShopService,
    private readonly usersService: UsersService,
    private readonly configService: ConfigService<EnvironmentConfig>,
  ) {}

  @Public()
  @Get("products")
  async getProducts(
    @Query("limit") limit?: string,
    @Query("featured") featured?: string,
    @Query("collection") collection?: unknown,
    @Query("collectionName") collectionName?: unknown,
  ) {
    // M2: Sanitize collection param — public endpoint, prevent NoSQL injection
    const safeCollection = ensureString(collectionName ?? collection);
    return this.shopService.getProducts(
      limit ? Number.parseInt(limit, 10) : 20,
      featured === "true",
      safeCollection,
    );
  }

  @Public()
  @Get("upcoming")
  async getUpcomingReleases(@Query("limit") limit?: string) {
    return this.shopService.getUpcomingReleases(
      limit ? Number.parseInt(limit, 10) : 10,
    );
  }

  @Public()
  @Get("product/:slug")
  async getProductBySlug(@Param("slug") slug: string) {
    const product = await this.shopService.getProductBySlug(slug);
    if (!product) {
      throw new NotFoundException("Producto no encontrado");
    }
    return product;
  }

  /**
   * A-KYC: shop orders require a verified identity
   * (OWASP A01 — server-side enforcement).
   */
  @UseGuards(SessionGuard, IdentityVerifiedGuard)
  @Post(["order", "orders"])
  @HttpCode(HttpStatus.CREATED)
  async createOrder(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateOrderDto,
  ) {
    const { userId } = req.user;
    const fullUser = await this.usersService.findById(userId);
    const membershipLevel = fullUser?.membershipLevel ?? null;
    return this.shopService.createOrder(userId, dto, membershipLevel);
  }

  @UseGuards(SessionGuard)
  @Post("order/cancel/:orderNumber")
  @HttpCode(HttpStatus.OK)
  async cancelOrder(
    @Req() req: AuthenticatedRequest,
    @Param("orderNumber") orderNumber: string,
  ) {
    const { userId } = req.user;
    return this.shopService.cancelOrder(userId, orderNumber);
  }

  @UseGuards(SessionGuard)
  @Get("my-orders")
  async getMyOrders(@Req() req: AuthenticatedRequest) {
    const { userId } = req.user;
    return this.shopService.getMyOrders(userId);
  }

  @UseGuards(SessionGuard)
  @Get("wishlist")
  async getWishlist(@Req() req: AuthenticatedRequest) {
    const { userId } = req.user;
    return this.shopService.getWishlist(userId);
  }

  @UseGuards(SessionGuard)
  @Post("wishlist/add")
  @HttpCode(HttpStatus.CREATED)
  async addToWishlist(
    @Req() req: AuthenticatedRequest,
    @Body() dto: AddWishlistDto,
  ) {
    const { userId } = req.user;
    return this.shopService.addToWishlist(userId, dto.productSlug);
  }

  @UseGuards(SessionGuard)
  @Post("wishlist/remove")
  @HttpCode(HttpStatus.OK)
  async removeFromWishlist(
    @Req() req: AuthenticatedRequest,
    @Body() dto: AddWishlistDto,
  ) {
    // M2: Use proper DTO instead of raw @Body("productSlug") — prevents
    // NoSQL injection via {"productSlug":{"$ne":null}} deleting all wishlist items
    const { userId } = req.user;
    return this.shopService.removeFromWishlist(userId, dto.productSlug);
  }

  @Public()
  @Post("internal/cron/expire-pending")
  @HttpCode(HttpStatus.OK)
  async expireStalePendingOrders(
    @Headers("x-cron-secret") headerSecret: string | undefined,
    @Headers("authorization") authorization: string | undefined,
  ) {
    this.assertCronSecret(headerSecret, authorization);
    const startedAt = Date.now();
    const expiredCount = await this.shopService.expireStalePendingOrders(60);
    const elapsed = Date.now() - startedAt;
    this.logger.log(
      `shop expire-pending cron completed in ${elapsed}ms — ${expiredCount} expired`,
    );
    return { ok: true, expired: expiredCount, elapsedMs: elapsed };
  }

  private assertCronSecret(
    headerSecret: string | undefined,
    authorization: string | undefined,
  ): void {
    const expected =
      this.configService.get<string>("CRON_SECRET", { infer: true }) ?? "";
    if (!expected) {
      throw new UnauthorizedException("CRON_SECRET not configured");
    }
    const provided =
      headerSecret ??
      (authorization?.startsWith("Bearer ")
        ? authorization.slice("Bearer ".length)
        : undefined) ??
      "";
    const expectedBuf = Buffer.from(expected);
    const providedBuf = Buffer.from(provided);
    if (
      providedBuf.length !== expectedBuf.length ||
      !timingSafeEqual(providedBuf, expectedBuf)
    ) {
      this.logger.warn(
        "Unauthorized cron invocation — secret mismatch (or missing).",
      );
      throw new UnauthorizedException("Invalid or missing cron secret");
    }
  }
}
