import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import type { Request } from "express";
import { SessionGuard } from "../auth/session.guard";
import { Public } from "../common/decorators";
import { GarageService } from "./garage.service";
import { CreateMotorcycleDto } from "./dto/create-motorcycle.dto";
import { UpdateMotorcycleDto } from "./dto/update-motorcycle.dto";
import { UpdateOdometerDto } from "./dto/update-odometer.dto";
import { CreateMaintenanceDto } from "./dto/create-maintenance.dto";
import { AlliedServiceOrderDto } from "./dto/allied-service-order.dto";
import { VerifyRuntDto } from "./dto/verify-runt.dto";
import { ensureString } from "../common/utils/sanitize-query.util";

interface AuthenticatedRequest extends Request {
  user: { userId: string; email?: string };
}

@Controller("garage")
@UseGuards(SessionGuard)
export class GarageController {
  constructor(private readonly garageService: GarageService) {}

  @Get()
  async getDashboard(
    @Req() req: AuthenticatedRequest,
    @Query("motorcycleId") motorcycleId?: unknown,
  ) {
    const motoId = motorcycleId ? ensureString(motorcycleId) : undefined;
    return this.garageService.getDashboard(req.user.userId, motoId);
  }

  @Post("motorcycles")
  @HttpCode(HttpStatus.CREATED)
  async createMotorcycle(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateMotorcycleDto,
  ) {
    return this.garageService.createMotorcycle(req.user.userId, dto);
  }

  @Put("motorcycles/:id")
  async updateMotorcycle(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: UpdateMotorcycleDto,
  ) {
    return this.garageService.updateMotorcycle(req.user.userId, id, dto);
  }

  @Delete("motorcycles/:id")
  async deleteMotorcycle(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    return this.garageService.deleteMotorcycle(req.user.userId, id);
  }

  @Post("motorcycles/:id/odometer")
  @HttpCode(HttpStatus.OK)
  async updateOdometer(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: UpdateOdometerDto,
  ) {
    return this.garageService.updateOdometer(req.user.userId, id, dto);
  }

  @Post("motorcycles/:id/maintenance")
  @HttpCode(HttpStatus.CREATED)
  async createMaintenance(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: CreateMaintenanceDto,
  ) {
    return this.garageService.createMaintenance(req.user.userId, id, dto);
  }

  @Post("motorcycles/:id/verify-runt")
  @HttpCode(HttpStatus.OK)
  async verifyRunt(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto?: VerifyRuntDto,
  ) {
    return this.garageService.verifyMotorcycleWithRunt(
      req.user.userId,
      id,
      dto,
    );
  }

  @Public()
  @Post("allied/service-order")
  @HttpCode(HttpStatus.CREATED)
  async recordAlliedServiceOrder(@Body() dto: AlliedServiceOrderDto) {
    return this.garageService.recordAlliedServiceOrder(dto);
  }

  @Get("allied/workshops")
  getAlliedWorkshops() {
    return this.garageService.getAlliedWorkshops();
  }
}
