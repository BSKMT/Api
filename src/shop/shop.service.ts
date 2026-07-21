import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
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

const LEGEND_LEVELS = new Set([
  "Legend",
  "Friend",
  "Rider",
  "Expert",
  "Master",
]);

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
  ) {}

  async getProducts(
    limit = 20,
    featuredOnly = false,
    collection?: string,
  ): Promise<ProductDocument[]> {
    const filter: Record<string, unknown> = { status: ProductStatus.PUBLISHED };
    if (featuredOnly) filter.featured = true;
    if (collection) filter.collection = collection;

    return this.productModel
      .find(filter)
      .sort({ featured: -1, createdAt: -1 })
      .limit(limit)
      .lean();
  }

  async getUpcomingReleases(limit = 10): Promise<ProductDocument[]> {
    return this.productModel
      .find({ status: ProductStatus.PUBLISHED, isNew: true })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  }

  async getProductBySlug(slug: string): Promise<ProductDocument | null> {
    return this.productModel
      .findOne({ slug, status: ProductStatus.PUBLISHED })
      .lean();
  }

  async createOrder(
    userId: string,
    dto: CreateOrderDto,
    membershipLevel: string | null = null,
  ) {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException("El pedido debe tener al menos un item");
    }

    const isMember =
      membershipLevel !== null && LEGEND_LEVELS.has(membershipLevel);

    let total = 0;
    let publicTotal = 0;
    let memberDiscount = 0;
    const orderItems = [];

    for (const item of dto.items) {
      const qty = item.quantity;

      // A3: Atomic check-and-decrement prevents TOCTOU race on stock
      const product = await this.productModel.findOneAndUpdate(
        {
          slug: item.productSlug,
          status: ProductStatus.PUBLISHED,
          stock: { $gte: qty },
        },
        { $inc: { stock: -qty } },
        { new: true },
      );

      if (!product) {
        // Rollback all previously decremented stock
        for (const oi of orderItems) {
          await this.productModel.updateOne(
            { slug: oi.productSlug },
            { $inc: { stock: oi.quantity } },
          );
        }
        throw new NotFoundException(
          `Producto no encontrado o stock insuficiente: ${item.productSlug}`,
        );
      }

      const publicPrice = product.publicPrice;
      const publicSubtotal = publicPrice * qty;

      let unitPrice = publicPrice;
      let discountPercent = 0;

      if (isMember) {
        discountPercent = product.memberDiscountPercent ?? 20;
        unitPrice = Math.round(publicPrice * (1 - discountPercent / 100));
      }

      const subtotal = unitPrice * qty;
      const itemDiscount = publicSubtotal - subtotal;

      total += subtotal;
      publicTotal += publicSubtotal;
      memberDiscount += itemDiscount;

      orderItems.push({
        productSlug: product.slug,
        productName: product.name,
        unitPrice,
        quantity: qty,
        subtotal,
      });
    }

    const orderNumber = `BSK-${Date.now().toString(36)}`;
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
      // A3: Rollback stock decrements if order save fails
      for (const oi of orderItems) {
        await this.productModel.updateOne(
          { slug: oi.productSlug },
          { $inc: { stock: oi.quantity } },
        );
      }
      throw err;
    }

    this.logger.log(
      // ADM-13: Redact user ID and amounts in logs
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
    // M11: Only link payment to PENDING orders — prevents resurrección of CANCELLED orders
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

    // M11: Only PENDING orders can be cancelled — PAID orders require admin refund
    if (order.status !== OrderStatus.PENDING) {
      throw new BadRequestException(
        "No se puede cancelar un pedido que ya fue pagado o enviado",
      );
    }

    order.status = OrderStatus.CANCELLED;
    await order.save();

    // M12: Restore stock with rollback logging — if any restore fails, log for manual reconciliation
    for (const item of order.items) {
      const restoreResult = await this.productModel.updateOne(
        { slug: item.productSlug },
        { $inc: { stock: item.quantity } },
      );
      if (restoreResult.modifiedCount === 0) {
        this.logger.error(
          `Stock restore failed for ${item.productSlug} (qty ${item.quantity}) on cancelled order ${orderNumber} — manual reconciliation needed`,
        );
      }
    }

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
