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
} from "@nestjs/common";
import type { Request } from "express";
import { Public } from "../common/decorators";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { ShopService } from "./shop.service";
import { CreateOrderDto } from "./dto/create-order.dto";
import { AddWishlistDto } from "./dto/add-wishlist.dto";

@Controller("shop")
export class ShopController {
  constructor(private readonly shopService: ShopService) {}

  @Public()
  @Get("products")
  async getProducts(
    @Query("limit") limit?: string,
    @Query("featured") featured?: string,
  ) {
    return this.shopService.getProducts(
      limit ? parseInt(limit, 10) : 20,
      featured === "true",
    );
  }

  @Public()
  @Get("product/:slug")
  async getProductBySlug(@Param("slug") slug: string) {
    const product = await this.shopService.getProductBySlug(slug);
    if (!product) {
      return { error: "Producto no encontrado" };
    }
    return product;
  }

  @UseGuards(JwtAuthGuard)
  @Post("order")
  @HttpCode(HttpStatus.CREATED)
  async createOrder(@Req() req: Request, @Body() dto: CreateOrderDto) {
    const user = req.user as { userId: string };
    return this.shopService.createOrder(user.userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post("order/cancel/:orderNumber")
  @HttpCode(HttpStatus.OK)
  async cancelOrder(
    @Req() req: Request,
    @Param("orderNumber") orderNumber: string,
  ) {
    const user = req.user as { userId: string };
    return this.shopService.cancelOrder(user.userId, orderNumber);
  }

  @UseGuards(JwtAuthGuard)
  @Get("my-orders")
  async getMyOrders(@Req() req: Request) {
    const user = req.user as { userId: string };
    return this.shopService.getMyOrders(user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get("wishlist")
  async getWishlist(@Req() req: Request) {
    const user = req.user as { userId: string };
    return this.shopService.getWishlist(user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post("wishlist/add")
  @HttpCode(HttpStatus.CREATED)
  async addToWishlist(@Req() req: Request, @Body() dto: AddWishlistDto) {
    const user = req.user as { userId: string };
    return this.shopService.addToWishlist(user.userId, dto.productSlug);
  }

  @UseGuards(JwtAuthGuard)
  @Post("wishlist/remove")
  @HttpCode(HttpStatus.OK)
  async removeFromWishlist(
    @Req() req: Request,
    @Body("productSlug") productSlug: string,
  ) {
    const user = req.user as { userId: string };
    return this.shopService.removeFromWishlist(user.userId, productSlug);
  }
}
