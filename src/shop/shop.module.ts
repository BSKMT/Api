import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { ShopController } from "./shop.controller";
import { ShopService } from "./shop.service";
import { Product, ProductSchema } from "./schemas/product.schema";
import { Order, OrderSchema } from "./schemas/order.schema";
import {
  WishlistItem,
  WishlistItemSchema,
} from "./schemas/wishlist-item.schema";
import { UsersModule } from "../users/users.module";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Product.name, schema: ProductSchema },
      { name: Order.name, schema: OrderSchema },
      { name: WishlistItem.name, schema: WishlistItemSchema },
    ]),
    UsersModule,
  ],
  controllers: [ShopController],
  providers: [ShopService],
  exports: [ShopService],
})
export class ShopModule {}
