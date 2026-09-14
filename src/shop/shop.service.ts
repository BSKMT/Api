import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
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

@Injectable()
export class ShopService {
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
    if (collection) filter.collection = collection;

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
      .find({ status: ProductStatus.PUBLISHED, isNew: true })
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
    const order = await this.orderModel.findOne({ userId, orderNumber });

    if (!order) {
      throw new NotFoundException("Pedido no encontrado");
    }

    if (order.status === OrderStatus.CANCELLED) {
      throw new BadRequestException("El pedido ya está cancelado");
    }

    if (order.status !== OrderStatus.PENDING) {
      throw new BadRequestException(
        "No se puede cancelar un pedido que ya fue pagado o enviado",
      );
    }

    order.status = OrderStatus.CANCELLED;
    await order.save();

    await restoreOrderStock(this.productModel, order, this.logger, orderNumber);

    this.logger.log(`Order cancelled: ${orderNumber} user=${userId}`);

    return { message: "Pedido cancelado exitosamente" };
  }

  async getWishlist(userId: string): Promise<WishlistItemDocument[]> {
    return this.wishlistModel.find({ userId }).sort({ createdAt: -1 }).lean();
  }

  async addToWishlist(
    userId: string,
    productSlug: string,
  ): Promise<WishlistItemDocument> {
    const product = await this.productModel.findOne({ slug: productSlug });
    if (!product) {
      throw new NotFoundException("Producto no encontrado");
    }

    const existing = await this.wishlistModel.findOne({
      userId,
      productSlug,
    });

    if (existing) {
      throw new ConflictException("El producto ya está en tu lista de deseos");
    }

    const item = new this.wishlistModel({ userId, productSlug });
    return item.save();
  }

  async removeFromWishlist(
    userId: string,
    productSlug: string,
  ): Promise<{ message: string }> {
    const result = await this.wishlistModel.deleteOne({
      userId,
      productSlug,
    });

    if (result.deletedCount === 0) {
      throw new NotFoundException(
        "Producto no encontrado en la lista de deseos",
      );
    }

    return { message: "Producto removido de la lista de deseos" };
  }
}
