import { Logger, NotFoundException } from "@nestjs/common";
import { Model } from "mongoose";
import { ProductDocument, ProductStatus } from "./schemas/product.schema";
import { OrderDocument } from "./schemas/order.schema";

export const LEGEND_LEVELS = new Set([
  "Legend",
  "Friend",
  "Rider",
  "Expert",
  "Master",
]);

export function isShopMember(membershipLevel: string | null): boolean {
  return membershipLevel !== null && LEGEND_LEVELS.has(membershipLevel);
}

export function generateOrderNumber(): string {
  return `BSK-${Date.now().toString(36)}`;
}

export function calculateItemPricing(
  publicPrice: number,
  qty: number,
  memberDiscountPercent = 15,
  isMember = false,
) {
  const publicSubtotal = publicPrice * qty;
  let unitPrice = publicPrice;

  if (isMember) {
    unitPrice = Math.round(publicPrice * (1 - memberDiscountPercent / 100));
  }

  const subtotal = unitPrice * qty;
  const itemDiscount = publicSubtotal - subtotal;

  return {
    unitPrice,
    subtotal,
    publicSubtotal,
    itemDiscount,
  };
}

export async function rollbackStock(
  productModel: Model<ProductDocument>,
  items: { productSlug: string; quantity: number }[],
): Promise<void> {
  for (const item of items) {
    await productModel.updateOne(
      { slug: item.productSlug },
      { $inc: { stock: item.quantity } },
    );
  }
}

export async function processOrderItems(
  productModel: Model<ProductDocument>,
  items: { productSlug: string; quantity: number }[],
  isMember: boolean,
) {
  let total = 0;
  let publicTotal = 0;
  let memberDiscount = 0;
  const orderItems: Array<{
    productSlug: string;
    productName: string;
    unitPrice: number;
    quantity: number;
    subtotal: number;
  }> = [];

  for (const item of items) {
    const qty = item.quantity;
    const product = await productModel.findOneAndUpdate(
      {
        slug: item.productSlug,
        status: ProductStatus.PUBLISHED,
        stock: { $gte: qty },
      },
      { $inc: { stock: -qty } },
      { new: true },
    );

    if (!product) {
      await rollbackStock(productModel, orderItems);
      throw new NotFoundException(
        `Producto no encontrado o stock insuficiente: ${item.productSlug}`,
      );
    }

    const pricing = calculateItemPricing(
      product.publicPrice,
      qty,
      product.memberDiscountPercent ?? 15,
      isMember,
    );

    total += pricing.subtotal;
    publicTotal += pricing.publicSubtotal;
    memberDiscount += pricing.itemDiscount;

    orderItems.push({
      productSlug: product.slug,
      productName: product.name,
      unitPrice: pricing.unitPrice,
      quantity: qty,
      subtotal: pricing.subtotal,
    });
  }

  return { total, publicTotal, memberDiscount, orderItems };
}

export async function restoreOrderStock(
  productModel: Model<ProductDocument>,
  order: OrderDocument,
  logger: Logger,
  orderNumber: string,
): Promise<void> {
  for (const item of order.items) {
    const restoreResult = await productModel.updateOne(
      { slug: item.productSlug },
      { $inc: { stock: item.quantity } },
    );
    if (restoreResult.modifiedCount === 0) {
      logger.error(
        `Stock restore failed for ${item.productSlug} (qty ${item.quantity}) on cancelled order ${orderNumber} — manual reconciliation needed`,
      );
    }
  }
}
