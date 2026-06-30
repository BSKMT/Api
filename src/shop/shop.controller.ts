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
} from "@nestjs/common";
import type { Request } from "express";
import { Public } from "../common/decorators";
import { SessionGuard } from "../auth/session.guard";
import { UsersService } from "../users/users.service";
import { ShopService } from "./shop.service";
import { CreateOrderDto } from "./dto/create-order.dto";
import { AddWishlistDto } from "./dto/add-wishlist.dto";

interface AuthenticatedRequest extends Request {
  user: { userId: string; email?: string };
}

@Controller("shop")
export class ShopController {
  constructor(
    private readonly shopService: ShopService,
    private readonly usersService: UsersService,
  ) {}

  @Public()
  @Get("products")
  async getProducts(
    @Query("limit") limit?: string,
    @Query("featured") featured?: string,
    @Query("collection") collection?: string,
  ) {
    return this.shopService.getProducts(
      limit ? parseInt(limit, 10) : 20,
      featured === "true",
      collection,
    );
  }

  @Public()
  @Get("upcoming")
  async getUpcomingReleases(@Query("limit") limit?: string) {
    return this.shopService.getUpcomingReleases(
      limit ? parseInt(limit, 10) : 10,
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

  @UseGuards(SessionGuard)
  @Post("order")
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
    @Body("productSlug") productSlug: string,
  ) {
    const { userId } = req.user;
    return this.shopService.removeFromWishlist(userId, productSlug);
  }
}
