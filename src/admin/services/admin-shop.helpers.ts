import { BadRequestException, Logger } from "@nestjs/common";
import { OrderStatus } from "../../shop/schemas/order.schema";
import type { KvCacheService } from "../../kv/kv-cache.service";

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
  limit?: number;
  page?: number;
}

export function clampPagination(rawLimit?: number, rawPage?: number) {
  const limit = Math.min(Math.max(rawLimit ?? 50, 1), 100);
  const page = Math.max(rawPage ?? 1, 1);
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

  if (
    nextStatus === OrderStatus.PAID &&
    previousStatus !== OrderStatus.PAID &&
    actorRole !== "admin"
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
