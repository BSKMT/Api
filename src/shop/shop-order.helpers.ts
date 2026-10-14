import { BadRequestException, Logger, NotFoundException } from "@nestjs/common";
import { Model } from "mongoose";
import { OrderDocument, OrderStatus } from "./schemas/order.schema";
import { ProductDocument } from "./schemas/product.schema";
import { CreateOrderDto } from "./dto/create-order.dto";
import { maskAmount, maskUserId } from "../common/utils/log-redact.util";
import {
  isShopMember,
  generateOrderNumber,
  processOrderItems,
  rollbackStock,
  restoreOrderStock,
} from "./shop.helpers";

export async function cancelPendingOrdersOlderThan(
  orderModel: Model<OrderDocument>,
  productModel: Model<ProductDocument>,
  cutoff: Date,
  userId?: string,
  logger?: Logger,
): Promise<number> {
  const filter: Record<string, unknown> = {
    status: OrderStatus.PENDING,
    createdAt: { $lt: cutoff },
  };
  if (userId) filter.userId = userId;

  const staleOrders = await orderModel.find(filter);
  let expiredCount = 0;
  for (const stale of staleOrders) {
    const updated = await orderModel.findOneAndUpdate(
      { _id: stale._id, status: OrderStatus.PENDING },
      { $set: { status: OrderStatus.CANCELLED } },
      { new: true },
    );
    if (updated && logger) {
      await restoreOrderStock(
        productModel,
        updated,
        logger,
        updated.orderNumber,
      );
      expiredCount++;
    }
  }
  return expiredCount;
}

export async function executeCreateOrder(
  orderModel: Model<OrderDocument>,
  productModel: Model<ProductDocument>,
  userId: string,
  dto: CreateOrderDto,
  membershipLevel: string | null,
  logger: Logger,
) {
  if (!dto.items || dto.items.length === 0) {
    throw new BadRequestException("El pedido debe tener al menos un item");
  }

  const cutoff = new Date(Date.now() - 60 * 60 * 1000);
  await cancelPendingOrdersOlderThan(
    orderModel,
    productModel,
    cutoff,
    userId,
    logger,
  );

  const pendingOrdersCount = await orderModel.countDocuments({
    userId,
    status: OrderStatus.PENDING,
  });
  if (pendingOrdersCount >= 3) {
    throw new BadRequestException(
      "Tienes pedidos pendientes de pago. Completa o cancela tus pedidos anteriores antes de crear uno nuevo.",
    );
  }

  const isMember = isShopMember(membershipLevel);
  const { total, publicTotal, memberDiscount, orderItems } =
    await processOrderItems(productModel, dto.items, isMember);

  const orderNumber = generateOrderNumber();
  const order = new orderModel({
    userId,
    orderNumber,
    items: orderItems,
    total,
    memberDiscount,
    status: total === 0 ? OrderStatus.PAID : OrderStatus.PENDING,
    shippingAddress: dto.shippingAddress ?? null,
  });

  let saved: OrderDocument;
  try {
    saved = await order.save();
  } catch (err) {
    await rollbackStock(productModel, orderItems);
    throw err;
  }

  logger.log(
    `Order created: ${orderNumber} user=${maskUserId(userId)} total=${maskAmount(total)} publicTotal=${maskAmount(publicTotal)} discount=${maskAmount(memberDiscount)} member=${isMember}`,
  );

  return {
    orderNumber: saved.orderNumber,
    total: saved.total,
    memberDiscount: saved.memberDiscount,
    status: saved.status,
    requiresPayment: saved.status === OrderStatus.PENDING,
  };
}

export async function executeCancelOrder(
  orderModel: Model<OrderDocument>,
  productModel: Model<ProductDocument>,
  userId: string,
  orderNumber: string,
  logger: Logger,
): Promise<{ message: string }> {
  const order = await orderModel.findOneAndUpdate(
    { userId, orderNumber, status: OrderStatus.PENDING },
    { $set: { status: OrderStatus.CANCELLED } },
    { new: true },
  );

  if (!order) {
    const existing = await orderModel.findOne({ userId, orderNumber });
    if (!existing) {
      throw new NotFoundException("Pedido no encontrado");
    }
    if (existing.status === OrderStatus.CANCELLED) {
      throw new BadRequestException("El pedido ya está cancelado");
    }
    throw new BadRequestException(
      "No se puede cancelar un pedido que ya fue pagado o enviado",
    );
  }

  await restoreOrderStock(productModel, order, logger, orderNumber);
  logger.log(`Order cancelled: ${orderNumber} user=${userId}`);

  return { message: "Pedido cancelado exitosamente" };
}
