import { ConflictException, NotFoundException } from "@nestjs/common";
import { Model } from "mongoose";
import type { ProductDocument } from "./schemas/product.schema";
import type { WishlistItemDocument } from "./schemas/wishlist-item.schema";

export async function executeAddToWishlist(
  productModel: Model<ProductDocument>,
  wishlistModel: Model<WishlistItemDocument>,
  userId: string,
  productSlug: string,
): Promise<WishlistItemDocument> {
  const product = await productModel.findOne({ slug: productSlug });
  if (!product) {
    throw new NotFoundException("Producto no encontrado");
  }

  const existing = await wishlistModel.findOne({
    userId,
    productSlug,
  });

  if (existing) {
    throw new ConflictException("El producto ya está en tu lista de deseos");
  }

  const item = new wishlistModel({ userId, productSlug });
  return item.save();
}

export async function executeRemoveFromWishlist(
  wishlistModel: Model<WishlistItemDocument>,
  userId: string,
  productSlug: string,
): Promise<{ message: string }> {
  const result = await wishlistModel.deleteOne({
    userId,
    productSlug,
  });

  if (result.deletedCount === 0) {
    throw new NotFoundException("Producto no encontrado en la lista de deseos");
  }

  return { message: "Producto removido de la lista de deseos" };
}
