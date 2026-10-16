import { randomInt } from "node:crypto";
import { NotFoundException, Logger } from "@nestjs/common";
import { Model } from "mongoose";
import { ProductDocument, ProductStatus } from "./schemas/product.schema";
import { OrderDocument } from "./schemas/order.schema";

export function isShopMember(membershipLevel: string | null): boolean {
  if (!membershipLevel) return false;
  const lvl = membershipLevel.toLowerCase();
  return (
    lvl === "active" ||
    lvl === "member" ||
    lvl === "vip" ||
    lvl === "pro" ||
    lvl.startsWith("tier")
  );
}

export function generateOrderNumber(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = randomInt(0x1000, 0xffff).toString(16).toUpperCase();
  return `ORD-${ts}-${rand}`;
}

export function calculateItemPricing(
  publicPrice: number,
  quantity: number,
  memberDiscountPercent: number,
  isMember: boolean,
) {
  const discountRate = isMember ? memberDiscountPercent / 100 : 0;
  const unitPrice = Math.round(publicPrice * (1 - discountRate));
  const subtotal = unitPrice * quantity;
  const publicSubtotal = publicPrice * quantity;
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
  await Promise.all(
    items.map((item) =>
      productModel.updateOne(
        { slug: item.productSlug },
        { $inc: { stock: item.quantity } },
      ),
    ),
  );
}

export async function processOrderItems(
  productModel: Model<ProductDocument>,
  items: { productSlug: string; quantity: number }[],
  isMember: boolean,
) {
  const reservations = await Promise.all(
    items.map(async (item) => {
      const product = await productModel.findOneAndUpdate(
        {
          slug: item.productSlug,
          status: ProductStatus.PUBLISHED,
          stock: { $gte: item.quantity },
        },
        { $inc: { stock: -item.quantity } },
        { new: true },
      );
      return { item, product };
    }),
  );

  const failed = reservations.find((r) => !r.product);
  if (failed) {
    const successfulReservations = reservations.flatMap((r) =>
      r.product
        ? [{ productSlug: r.item.productSlug, quantity: r.item.quantity }]
        : [],
    );
    await rollbackStock(productModel, successfulReservations);
    throw new NotFoundException(
      `Producto no encontrado o stock insuficiente: ${failed.item.productSlug}`,
    );
  }

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

  for (const { item, product } of reservations) {
    if (!product) continue;
    const pricing = calculateItemPricing(
      product.publicPrice,
      item.quantity,
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
      quantity: item.quantity,
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
  await Promise.all(
    order.items.map(async (item) => {
      const restoreResult = await productModel.updateOne(
        { slug: item.productSlug },
        { $inc: { stock: item.quantity } },
      );
      if (restoreResult.modifiedCount === 0) {
        logger.error(
          `Stock restore failed for ${item.productSlug} (qty ${item.quantity}) on cancelled order ${orderNumber} — manual reconciliation needed`,
        );
      }
    }),
  );
}
