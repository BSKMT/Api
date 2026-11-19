import { BadRequestException, NotFoundException, Logger } from "@nestjs/common";
import { Model } from "mongoose";
import { OrderDocument, OrderStatus } from "../../shop/schemas/order.schema";
import { ProductDocument } from "../../shop/schemas/product.schema";
import type { KvCacheService } from "../../kv/kv-cache.service";
import { parsePositiveInt } from "../../common/utils/pagination.util";

export const VALID_ORDER_TRANSITIONS: Record<string, Set<string>> = {
  [OrderStatus.PENDING]: new Set([OrderStatus.PAID, OrderStatus.CANCELLED]),
  [OrderStatus.PAID]: new Set([OrderStatus.SHIPPED, OrderStatus.CANCELLED]),
  [OrderStatus.SHIPPED]: new Set([OrderStatus.DELIVERED]),
  [OrderStatus.DELIVERED]: new Set(),
  [OrderStatus.CANCELLED]: new Set(),
};

export interface AdminListProductsFilters {
  status?: string;
  collection?: string;
  collectionName?: string;
  limit?: number;
  page?: number;
}

export function clampPagination(rawLimit?: number, rawPage?: number) {
  const limit = parsePositiveInt(rawLimit, 50, 100);
  const page = parsePositiveInt(rawPage, 1, 10000);
  const skip = (page - 1) * limit;
  return { limit, page, skip };
}

export function validateOrderStatusTransition(
  previousStatus: OrderStatus,
  nextStatus: OrderStatus,
  actorRole?: string,
  actorId?: string,
  orderNumber?: string,
  logger?: Logger,
) {
  if (
    nextStatus !== previousStatus &&
    !VALID_ORDER_TRANSITIONS[previousStatus]?.has(nextStatus)
  ) {
    throw new BadRequestException(
      `Transición de estado inválida: ${previousStatus} → ${nextStatus}`,
    );
  }

  const normalizedRole = (actorRole ?? "").toLowerCase();
  if (
    nextStatus === OrderStatus.PAID &&
    previousStatus !== OrderStatus.PAID &&
    normalizedRole !== "admin" &&
    normalizedRole !== "superadmin"
  ) {
    logger?.warn(
      `Blocked order-to-PAID transition by non-admin actor: order=${orderNumber} actor=${actorId ?? "unknown"} role=${actorRole ?? "unknown"}`,
    );
    throw new BadRequestException(
      "Solo un administrador puede marcar un pedido como pagado. Sube la evidencia del pago y pide a un admin que apruebe el cambio.",
    );
  }
}

export async function invalidateProductCacheHelper(
  kvCache: KvCacheService,
  slug?: string,
): Promise<void> {
  await kvCache.invalidatePrefix("shop:products:");
  await kvCache.invalidatePrefix("shop:upcoming:");
  if (slug) await kvCache.delete(`shop:product:${slug}`);
}

export async function executeUpdateOrderStatus(
  orderModel: Model<OrderDocument>,
  productModel: Model<ProductDocument>,
  orderNumber: string,
  dto: { status: OrderStatus; trackingNumber?: string },
  actorId: string | undefined,
  actorRole: string | undefined,
  logger: Logger,
): Promise<OrderDocument> {
  const order = await orderModel.findOne({ orderNumber });
  if (!order) {
    throw new NotFoundException("Pedido no encontrado");
  }

  const previousStatus = order.status;
  validateOrderStatusTransition(
    previousStatus,
    dto.status,
    actorRole,
    actorId,
    orderNumber,
    logger,
  );

  // M-05: Atomically transition order status BEFORE restoring stock to prevent double-restock races.
  const updateFields: Record<string, unknown> = { status: dto.status };
  if (dto.trackingNumber) updateFields.trackingNumber = dto.trackingNumber;

  const saved = await orderModel.findOneAndUpdate(
    { orderNumber, status: previousStatus },
    { $set: updateFields },
    { new: true },
  );
  if (!saved) {
    throw new BadRequestException(
      "El estado del pedido cambió concurrentemente. Recarga e intenta nuevamente.",
    );
  }

  if (
    dto.status === OrderStatus.CANCELLED &&
    previousStatus !== OrderStatus.CANCELLED
  ) {
    await Promise.all(
      saved.items.map((item) =>
        productModel.updateOne(
          { slug: item.productSlug },
          { $inc: { stock: item.quantity } },
        ),
      ),
    );
  }

  logger.log(
    `Order status updated: ${orderNumber} ${previousStatus} -> ${dto.status} by ${actorId ?? "unknown"}`,
  );
  return saved;
}
