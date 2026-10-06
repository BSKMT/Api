import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  OnModuleInit,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { KvCacheService } from "../kv/kv-cache.service";
import {
  Product,
  ProductDocument,
  ProductStatus,
} from "./schemas/product.schema";
import { Order, OrderDocument, OrderStatus } from "./schemas/order.schema";
import {
  WishlistItem,
  WishlistItemDocument,
} from "./schemas/wishlist-item.schema";
import { CreateOrderDto } from "./dto/create-order.dto";
import { maskAmount, maskUserId } from "../common/utils/log-redact.util";
import {
  isShopMember,
  generateOrderNumber,
  processOrderItems,
  rollbackStock,
  restoreOrderStock,
} from "./shop.helpers";
import {
  executeAddToWishlist,
  executeRemoveFromWishlist,
} from "./shop-wishlist.helpers";

@Injectable()
export class ShopService implements OnModuleInit {
  private readonly logger = new Logger(ShopService.name);

  constructor(
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
    @InjectModel(WishlistItem.name)
    private readonly wishlistModel: Model<WishlistItemDocument>,
    private readonly kvCache: KvCacheService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      // MongoDB official migration: rename legacy fields that conflicted with Mongoose Document reserved keys
      const [colResult, newResult] = await Promise.all([
        this.productModel.updateMany(
          { collection: { $exists: true } },
          { $rename: { collection: "collectionName" } },
        ),
        this.productModel.updateMany(
          { isNew: { $exists: true } },
          { $rename: { isNew: "isNewProduct" } },
        ),
      ]);
      if (colResult.modifiedCount > 0 || newResult.modifiedCount > 0) {
        this.logger.log(
          `[Mongoose Schema Migration] Migrated legacy product keys via MongoDB $rename (collections: ${colResult.modifiedCount}, isNew: ${newResult.modifiedCount})`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `[Mongoose Schema Migration] Non-fatal legacy product keys check: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async getProducts(
    limit = 20,
    featuredOnly = false,
    collection?: string,
  ): Promise<ProductDocument[]> {
    const cacheKey = `shop:products:${limit}:${featuredOnly}:${collection ?? ""}`;
    const cached = await this.kvCache.get<ProductDocument[]>(cacheKey);
    if (cached) return cached;

    const filter: Record<string, unknown> = { status: ProductStatus.PUBLISHED };
    if (featuredOnly) filter.featured = true;
    if (collection) {
      filter.$or = [{ collectionName: collection }, { collection: collection }];
    }

    const result = await this.productModel
      .find(filter)
      .sort({ featured: -1, createdAt: -1 })
      .limit(limit)
      .lean();

    await this.kvCache.set(cacheKey, result, 300);
    return result;
  }

  async getUpcomingReleases(limit = 10): Promise<ProductDocument[]> {
    const cacheKey = `shop:upcoming:${limit}`;
    const cached = await this.kvCache.get<ProductDocument[]>(cacheKey);
    if (cached) return cached;

    const result = await this.productModel
      .find({
        status: ProductStatus.PUBLISHED,
        $or: [{ isNewProduct: true }, { isNew: true }],
      })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    await this.kvCache.set(cacheKey, result, 300);
    return result;
  }

  async getProductBySlug(slug: string): Promise<ProductDocument | null> {
    const cacheKey = `shop:product:${slug}`;
    const cached = await this.kvCache.get<ProductDocument>(cacheKey);
    if (cached) return cached;

    const result = await this.productModel
      .findOne({ slug, status: ProductStatus.PUBLISHED })
      .lean();

    if (result) await this.kvCache.set(cacheKey, result, 300);
    return result;
  }

  async createOrder(
    userId: string,
    dto: CreateOrderDto,
    membershipLevel: string | null = null,
  ) {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException("El pedido debe tener al menos un item");
    }

    // F-04: Mitigar DoS de inventario limitando pedidos PENDING concurrentes por usuario
    const pendingOrdersCount = await this.orderModel.countDocuments({
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
      await processOrderItems(this.productModel, dto.items, isMember);

    const orderNumber = generateOrderNumber();
    const order = new this.orderModel({
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
      await rollbackStock(this.productModel, orderItems);
      throw err;
    }

    this.logger.log(
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

  async linkOrderPayment(
    orderNumber: string,
    transactionReference: string,
  ): Promise<OrderDocument> {
    const order = await this.orderModel.findOneAndUpdate(
      { orderNumber, status: OrderStatus.PENDING },
      {
        transactionReference,
        status: OrderStatus.PAID,
      },
      { new: true },
    );

    if (!order) {
      throw new NotFoundException(
        "Pedido no encontrado o ya no está pendiente de pago",
      );
    }

    this.logger.log(
      `Order payment linked: ${orderNumber} ref=${transactionReference}`,
    );

    return order;
  }

  async getMyOrders(userId: string): Promise<OrderDocument[]> {
    return this.orderModel.find({ userId }).sort({ createdAt: -1 }).lean();
  }

  async getOrderByOrderNumber(
    orderNumber: string,
    userId?: string,
    mustBePending = false,
  ): Promise<OrderDocument | null> {
    const filter: Record<string, unknown> = { orderNumber };
    if (userId) filter.userId = userId;
    if (mustBePending) filter.status = OrderStatus.PENDING;
    return this.orderModel.findOne(filter).lean();
  }

  async cancelOrder(
    userId: string,
    orderNumber: string,
  ): Promise<{ message: string }> {
    // F-03 / F-04: Transición atómica de PENDING a CANCELLED
    const order = await this.orderModel.findOneAndUpdate(
      { userId, orderNumber, status: OrderStatus.PENDING },
      { $set: { status: OrderStatus.CANCELLED } },
      { new: true },
    );

    if (!order) {
      const existing = await this.orderModel.findOne({ userId, orderNumber });
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

    await restoreOrderStock(this.productModel, order, this.logger, orderNumber);

    this.logger.log(`Order cancelled: ${orderNumber} user=${userId}`);

    return { message: "Pedido cancelado exitosamente" };
  }

  /**
   * F-04: Libera stock de pedidos PENDING que hayan superado el TTL máximo de pago (default 60 min).
   */
  async expireStalePendingOrders(maxAgeMinutes = 60): Promise<number> {
    const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000);
    const staleOrders = await this.orderModel.find({
      status: OrderStatus.PENDING,
      createdAt: { $lt: cutoff },
    });

    let expiredCount = 0;
    for (const order of staleOrders) {
      const updated = await this.orderModel.findOneAndUpdate(
        { _id: order._id, status: OrderStatus.PENDING },
        { $set: { status: OrderStatus.CANCELLED } },
        { new: true },
      );
      if (updated) {
        await restoreOrderStock(
          this.productModel,
          updated,
          this.logger,
          updated.orderNumber,
        );
        expiredCount++;
        this.logger.log(
          `Stale pending order expired and stock released: ${updated.orderNumber}`,
        );
      }
    }
    return expiredCount;
  }

  async getWishlist(userId: string): Promise<WishlistItemDocument[]> {
    return this.wishlistModel.find({ userId }).sort({ createdAt: -1 }).lean();
  }

  async addToWishlist(
    userId: string,
    productSlug: string,
  ): Promise<WishlistItemDocument> {
    return executeAddToWishlist(
      this.productModel,
      this.wishlistModel,
      userId,
      productSlug,
    );
  }

  async removeFromWishlist(
    userId: string,
    productSlug: string,
  ): Promise<{ message: string }> {
    return executeRemoveFromWishlist(this.wishlistModel, userId, productSlug);
  }
}
