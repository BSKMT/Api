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
    private productModel: Model<ProductDocument>,
    @InjectModel(Order.name)
    private orderModel: Model<OrderDocument>,
    @InjectModel(WishlistItem.name)
    private wishlistModel: Model<WishlistItemDocument>,
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
      const product = await this.productModel.findOne({
        slug: item.productSlug,
        status: ProductStatus.PUBLISHED,
      });

      if (!product) {
        throw new NotFoundException(
          `Producto no encontrado: ${item.productSlug}`,
        );
      }

      if (product.stock < item.quantity) {
        throw new BadRequestException(
          `Stock insuficiente para: ${product.name}`,
        );
      }

      const qty = item.quantity;
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

      await this.productModel.updateOne(
        { _id: product._id },
        { $inc: { stock: -qty } },
      );
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

    const saved = await order.save();

    this.logger.log(
      `Order created: ${orderNumber} user=${userId} total=${total} publicTotal=${publicTotal} discount=${memberDiscount} member=${isMember}`,
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
      { orderNumber },
      {
        transactionReference,
        status: OrderStatus.PAID,
      },
      { new: true },
    );

    if (!order) {
      throw new NotFoundException("Pedido no encontrado");
    }

    this.logger.log(
      `Order payment linked: ${orderNumber} ref=${transactionReference}`,
    );

    return order;
  }

  async getMyOrders(userId: string): Promise<OrderDocument[]> {
    return this.orderModel.find({ userId }).sort({ createdAt: -1 }).lean();
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

    if (
      order.status === OrderStatus.SHIPPED ||
      order.status === OrderStatus.DELIVERED
    ) {
      throw new BadRequestException("No se puede cancelar un pedido enviado");
    }

    order.status = OrderStatus.CANCELLED;
    await order.save();

    for (const item of order.items) {
      await this.productModel.updateOne(
        { slug: item.productSlug },
        { $inc: { stock: item.quantity } },
      );
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
