import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { KvCacheService } from "../../kv/kv-cache.service";
import {
  Product,
  ProductDocument,
  ProductStatus,
} from "../../shop/schemas/product.schema";
import {
  Order,
  OrderDocument,
  OrderStatus,
} from "../../shop/schemas/order.schema";
import { CreateProductDto } from "../dto/create-product.dto";
import { UpdateProductDto } from "../dto/update-product.dto";
import { UpdateOrderStatusDto } from "../dto/update-order-status.dto";
import { ensureString } from "../../common/utils/sanitize-query.util";
import {
  clampPagination,
  validateOrderStatusTransition,
  invalidateProductCacheHelper,
  type AdminListProductsFilters,
} from "./admin-shop.helpers";

@Injectable()
export class AdminShopService {
  private readonly logger = new Logger(AdminShopService.name);

  constructor(
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
    private readonly kvCache: KvCacheService,
  ) {}

  async listProducts(filters: AdminListProductsFilters) {
    // M2: Sanitize filter to prevent NoSQL operator injection
    const filter: Record<string, unknown> = {};
    const status = ensureString(filters.status);
    const collection = ensureString(filters.collection);
    if (status) filter.status = status;
    if (collection) filter.collection = collection;

    const { limit, page, skip } = clampPagination(filters.limit, filters.page);

    const [items, total] = await Promise.all([
      this.productModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.productModel.countDocuments(filter),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async getProduct(slug: string): Promise<ProductDocument> {
    const product = await this.productModel.findOne({ slug }).lean();
    if (!product) {
      throw new NotFoundException("Producto no encontrado");
    }
    return product;
  }

  async createProduct(dto: CreateProductDto): Promise<ProductDocument> {
    const existing = await this.productModel.findOne({ slug: dto.slug });
    if (existing) {
      throw new ConflictException("Ya existe un producto con ese slug");
    }

    const created = (
      await this.productModel.insertMany([
        {
          ...dto,
          status: dto.status ?? ProductStatus.DRAFT,
          stock: dto.stock ?? 0,
          memberDiscountPercent: dto.memberDiscountPercent ?? 20,
          isNew: dto.isNew ?? false,
          featured: dto.featured ?? true,
        },
      ])
    )[0] as unknown as ProductDocument;

    this.logger.log(`Product created: slug=${dto.slug} by admin`);
    await invalidateProductCacheHelper(this.kvCache);
    return created;
  }

  async updateProduct(
    slug: string,
    dto: UpdateProductDto,
  ): Promise<ProductDocument> {
    const updateFields = { ...dto };
    const updated = await this.productModel.findOneAndUpdate(
      { slug },
      { $set: updateFields },
      { new: true },
    );
    if (!updated) {
      throw new NotFoundException("Producto no encontrado");
    }
    this.logger.log(`Product updated: slug=${slug}`);
    await invalidateProductCacheHelper(this.kvCache, slug);
    return updated;
  }

  async deleteProduct(slug: string): Promise<{ message: string }> {
    const ordersWithProduct = await this.orderModel.countDocuments({
      "items.productSlug": slug,
      status: { $nin: [OrderStatus.CANCELLED, OrderStatus.DELIVERED] },
    });
    if (ordersWithProduct > 0) {
      throw new BadRequestException(
        `No se puede eliminar: hay ${ordersWithProduct} pedidos activos con el producto. Usa discontinuar.`,
      );
    }

    const result = await this.productModel.deleteOne({ slug });
    if (result.deletedCount === 0) {
      throw new NotFoundException("Producto no encontrado");
    }
    this.logger.log(`Product deleted: slug=${slug}`);
    await invalidateProductCacheHelper(this.kvCache, slug);
    return { message: "Producto eliminado exitosamente" };
  }

  async setProductStatus(
    slug: string,
    status: ProductStatus,
  ): Promise<ProductDocument> {
    const product = await this.productModel.findOneAndUpdate(
      { slug },
      { $set: { status } },
      { new: true },
    );
    if (!product) {
      throw new NotFoundException("Producto no encontrado");
    }
    this.logger.log(`Product status set: slug=${slug} status=${status}`);
    await invalidateProductCacheHelper(this.kvCache, slug);
    return product;
  }

  async listOrders(filters: {
    status?: string;
    limit?: number;
    page?: number;
  }) {
    // M2: Sanitize filter
    const filter: Record<string, unknown> = {};
    const status = ensureString(filters.status);
    if (status) filter.status = status;

    const { limit, page, skip } = clampPagination(filters.limit, filters.page);

    const [items, total] = await Promise.all([
      this.orderModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.orderModel.countDocuments(filter),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async getOrder(orderNumber: string): Promise<OrderDocument> {
    const order = await this.orderModel
      .findOne({ orderNumber })
      .select("-shippingAddress")
      .lean();
    if (!order) {
      throw new NotFoundException("Pedido no encontrado");
    }
    return order;
  }

  async updateOrderStatus(
    orderNumber: string,
    dto: UpdateOrderStatusDto,
    actorId?: string,
    actorRole?: string,
  ): Promise<OrderDocument> {
    const order = await this.orderModel.findOne({ orderNumber });
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
      this.logger,
    );

    order.status = dto.status;
    if (dto.trackingNumber) order.trackingNumber = dto.trackingNumber;

    if (
      dto.status === OrderStatus.CANCELLED &&
      previousStatus !== OrderStatus.CANCELLED
    ) {
      for (const item of order.items) {
        await this.productModel.updateOne(
          { slug: item.productSlug },
          { $inc: { stock: item.quantity } },
        );
      }
    }

    const saved = await order.save();
    // M7: Log actor for audit trail
    this.logger.log(
      `Order status updated: ${orderNumber} ${previousStatus} -> ${dto.status} by ${actorId ?? "unknown"}`,
    );
    return saved;
  }
}
