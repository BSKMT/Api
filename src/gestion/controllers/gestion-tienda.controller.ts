import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  NotFoundException,
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
  async listOrders(@Query("status") status?: string) {
    const filter: Record<string, unknown> = {};
    if (status) {
      filter.status = status;
    }

    const orders = await this.orderModel
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    return { orders };
  }

  @Post("orders/:id/dispatch")
  @HttpCode(HttpStatus.OK)
  async dispatchOrder(@Param("id") id: string, @Body() dto: DispatchOrderDto) {
    const order = await this.orderModel.findById(id);
    if (!order) {
      throw new NotFoundException("Orden no encontrada");
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
  @HttpCode(HttpStatus.OK)
  async deliverOrder(@Param("id") id: string) {
    const order = await this.orderModel.findById(id);
    if (!order) {
      throw new NotFoundException("Orden no encontrada");
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
