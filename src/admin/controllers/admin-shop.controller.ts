import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles, Role } from "../../common/decorators";
import { AdminShopService } from "../services/admin-shop.service";
import { CreateProductDto } from "../dto/create-product.dto";
import { UpdateProductDto } from "../dto/update-product.dto";
import { UpdateOrderStatusDto } from "../dto/update-order-status.dto";
import { ProductStatus } from "../../shop/schemas/product.schema";

@Controller("admin/shop")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.EVENT_MANAGER)
export class AdminShopController {
  constructor(private readonly adminShopService: AdminShopService) {}

  @Get("products")
  async listProducts(
    @Query("status") status?: string,
    @Query("collection") collection?: string,
    @Query("limit") limit?: string,
    @Query("page") page?: string,
  ) {
    return this.adminShopService.listProducts({
      status,
      collection,
      limit: limit ? parseInt(limit, 10) : 50,
      page: page ? parseInt(page, 10) : 1,
    });
  }

  @Get("products/:slug")
  async getProduct(@Param("slug") slug: string) {
    return this.adminShopService.getProduct(slug);
  }

  @Post("products")
  @HttpCode(HttpStatus.CREATED)
  async createProduct(@Body() dto: CreateProductDto) {
    return this.adminShopService.createProduct(dto);
  }

  @Put("products/:slug")
  async updateProduct(
    @Param("slug") slug: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.adminShopService.updateProduct(slug, dto);
  }

  @Delete("products/:slug")
  async removeProduct(@Param("slug") slug: string) {
    return this.adminShopService.deleteProduct(slug);
  }

  @Post("products/:slug/publish")
  @HttpCode(HttpStatus.OK)
  async publish(@Param("slug") slug: string) {
    return this.adminShopService.setProductStatus(
      slug,
      ProductStatus.PUBLISHED,
    );
  }

  @Post("products/:slug/discontinue")
  @HttpCode(HttpStatus.OK)
  async discontinue(@Param("slug") slug: string) {
    return this.adminShopService.setProductStatus(
      slug,
      ProductStatus.DISCONTINUED,
    );
  }

  @Get("orders")
  async listOrders(
    @Query("status") status?: string,
    @Query("limit") limit?: string,
    @Query("page") page?: string,
  ) {
    return this.adminShopService.listOrders({
      status,
      limit: limit ? parseInt(limit, 10) : 50,
      page: page ? parseInt(page, 10) : 1,
    });
  }

  @Get("orders/:orderNumber")
  async getOrder(@Param("orderNumber") orderNumber: string) {
    return this.adminShopService.getOrder(orderNumber);
  }

  @Post("orders/:orderNumber/status")
  @HttpCode(HttpStatus.OK)
  async updateOrderStatus(
    @Param("orderNumber") orderNumber: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.adminShopService.updateOrderStatus(orderNumber, dto);
  }
}
