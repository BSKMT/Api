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
} from "../../shop/schemas/product.schema";
import {
  Order,
  OrderDocument,
  OrderStatus,
} from "../../shop/schemas/order.schema";
import { CreateProductDto } from "../dto/create-product.dto";
import { UpdateProductDto } from "../dto/update-product.dto";
import { UpdateOrderStatusDto } from "../dto/update-order-status.dto";

@Injectable()
export class AdminShopService {
  private readonly logger = new Logger(AdminShopService.name);

  constructor(
    @InjectModel(Product.name)
    private productModel: Model<ProductDocument>,
    @InjectModel(Order.name)
    private orderModel: Model<OrderDocument>,
  ) {}

  async listProducts(filters: {
    status?: string;
    collection?: string;
    limit?: number;
    page?: number;
  }) {
    const filter: Record<string, unknown> = {};
    if (filters.status) filter.status = filters.status;
    if (filters.collection) filter.collection = filters.collection;

    const limit = filters.limit ?? 50;
    const page = filters.page ?? 1;
    const skip = (page - 1) * limit;

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
    return created;
  }

  async updateProduct(
    slug: string,
    dto: UpdateProductDto,
  ): Promise<ProductDocument> {
    const updated = await this.productModel.findOneAndUpdate(
      { slug },
      { $set: { ...dto } },
      { new: true },
    );
    if (!updated) {
      throw new NotFoundException("Producto no encontrado");
    }
    this.logger.log(`Product updated: slug=${slug}`);
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
    return product;
  }

  async listOrders(filters: {
    status?: string;
    limit?: number;
    page?: number;
  }) {
    const filter: Record<string, unknown> = {};
    if (filters.status) filter.status = filters.status;

    const limit = filters.limit ?? 50;
    const page = filters.page ?? 1;
    const skip = (page - 1) * limit;

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
    const order = await this.orderModel.findOne({ orderNumber }).lean();
    if (!order) {
      throw new NotFoundException("Pedido no encontrado");
    }
    return order;
  }

  async updateOrderStatus(
    orderNumber: string,
    dto: UpdateOrderStatusDto,
  ): Promise<OrderDocument> {
    const order = await this.orderModel.findOne({ orderNumber });
    if (!order) {
      throw new NotFoundException("Pedido no encontrado");
    }

    const previousStatus = order.status;
    if (
      previousStatus === OrderStatus.CANCELLED &&
      dto.status !== OrderStatus.CANCELLED
    ) {
      throw new BadRequestException(
        "No se puede reactivar un pedido cancelado",
      );
    }

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
    this.logger.log(
      `Order status updated: ${orderNumber} ${previousStatus} -> ${dto.status}`,
    );
    return saved;
  }
}
