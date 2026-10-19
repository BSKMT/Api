import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { SessionGuard } from "../../auth/session.guard";
import { GestionGuard } from "../../common/guards/gestion.guard";
import { RequireSubroles } from "../../common/decorators/subroles.decorator";
import { UserSubrole } from "../../users/schemas/user.schema";
import { IsString, MinLength, MaxLength } from "class-validator";
import {
  Order,
  OrderDocument,
  OrderStatus,
} from "../../shop/schemas/order.schema";
import { ParseObjectIdPipe } from "../../common/pipes/parse-object-id.pipe";
import { ensureString } from "../../common/utils/sanitize-query.util";

class DispatchOrderDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  trackingNumber!: string;
}

@Controller("gestion/tienda")
@UseGuards(SessionGuard, GestionGuard)
@RequireSubroles(UserSubrole.LIDER_TIENDA, UserSubrole.GESTOR_TIENDA)
export class GestionTiendaController {
  constructor(
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
  ) {}

  @Get("orders")
  async listOrders(@Query("status") status?: unknown) {
    const filter: Record<string, unknown> = {};
    const statusStr = ensureString(status);
    if (statusStr) {
      const cleanStatus = statusStr.trim().toUpperCase();
      if (Object.values(OrderStatus).includes(cleanStatus as OrderStatus)) {
        filter.status = cleanStatus;
      }
    }

    const orders = await this.orderModel
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    return { orders };
  }

  @Post("orders/:id/dispatch")
  @Put("orders/:id/dispatch")
  @Patch("orders/:id/dispatch")
  @HttpCode(HttpStatus.OK)
  async dispatchOrder(
    @Param("id", ParseObjectIdPipe) id: string,
    @Body() dto: DispatchOrderDto,
  ) {
    const order = await this.orderModel.findById(id);
    if (!order) {
      throw new NotFoundException("Orden no encontrada");
    }

    if (order.status !== OrderStatus.PAID) {
      throw new BadRequestException(
        `Solo se pueden despachar órdenes en estado PAID (estado actual: ${order.status}).`,
      );
    }

    order.status = OrderStatus.SHIPPED;
    order.trackingNumber = dto.trackingNumber;
    await order.save();

    return {
      success: true,
      message: "Orden despachada y número de guía asignado",
      order,
    };
  }

  @Post("orders/:id/deliver")
  @Put("orders/:id/deliver")
  @Patch("orders/:id/deliver")
  @HttpCode(HttpStatus.OK)
  async deliverOrder(@Param("id", ParseObjectIdPipe) id: string) {
    const order = await this.orderModel.findById(id);
    if (!order) {
      throw new NotFoundException("Orden no encontrada");
    }

    if (order.status !== OrderStatus.SHIPPED) {
      throw new BadRequestException(
        `Solo se pueden marcar como entregadas órdenes en estado SHIPPED (estado actual: ${order.status}).`,
      );
    }

    order.status = OrderStatus.DELIVERED;
    await order.save();

    return {
      success: true,
      message: "Orden marcada como entregada",
      order,
    };
  }
}
