import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import { SessionGuard } from "../auth/session.guard";
import { IdentityVerifiedGuard } from "../common/guards/identity-verified.guard";
import { AlliedWorkshopGuard } from "./guards/allied-workshop.guard";
import { Public } from "../common/decorators";
import { GarageService } from "./garage.service";
import { CreateMotorcycleDto } from "./dto/create-motorcycle.dto";
import { UpdateMotorcycleDto } from "./dto/update-motorcycle.dto";
import { UpdateOdometerDto } from "./dto/update-odometer.dto";
import { CreateMaintenanceDto } from "./dto/create-maintenance.dto";
import { AlliedServiceOrderDto } from "./dto/allied-service-order.dto";
import { VerifyRuntDto } from "./dto/verify-runt.dto";
import { LookupPlateDto } from "./dto/lookup-plate.dto";
import { ensureString } from "../common/utils/sanitize-query.util";
import { ParseObjectIdPipe } from "../common/pipes/parse-object-id.pipe";

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
  @Patch("motorcycles/:id")
  async updateMotorcycle(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseObjectIdPipe) id: string,
    @Body() dto: UpdateMotorcycleDto,
  ) {
    return this.garageService.updateMotorcycle(req.user.userId, id, dto);
  }

  @Delete("motorcycles/:id")
  async deleteMotorcycle(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseObjectIdPipe) id: string,
  ) {
    return this.garageService.deleteMotorcycle(req.user.userId, id);
  }

  @Post("motorcycles/:id/odometer")
  @HttpCode(HttpStatus.OK)
  async updateOdometer(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseObjectIdPipe) id: string,
    @Body() dto: UpdateOdometerDto,
  ) {
    return this.garageService.updateOdometer(req.user.userId, id, dto);
  }

  @Post("motorcycles/:id/maintenance")
  @HttpCode(HttpStatus.CREATED)
  async createMaintenance(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseObjectIdPipe) id: string,
    @Body() dto: CreateMaintenanceDto,
  ) {
    return this.garageService.createMaintenance(req.user.userId, id, dto);
  }

  @Post("motorcycles/:id/verify-runt")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  async verifyRunt(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseObjectIdPipe) id: string,
    @Body() dto?: VerifyRuntDto,
  ) {
    return this.garageService.verifyMotorcycleWithRunt(
      req.user.userId,
      id,
      dto,
    );
  }

  @Get("lookup-plate")
  @UseGuards(IdentityVerifiedGuard)
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  async lookupPlateGet(
    @Req() req: AuthenticatedRequest,
    @Query("plate") plate?: unknown,
  ) {
    const cleanPlate = ensureString(plate)?.trim();
    if (!cleanPlate || !/^[A-Za-z0-9-]{4,12}$/.test(cleanPlate)) {
      return { error: "La placa es requerida y debe tener un formato válido" };
    }
    return await this.garageService.lookupVehicleByPlate(
      req.user.userId,
      cleanPlate,
    );
  }

  @Post("lookup-plate")
  @UseGuards(IdentityVerifiedGuard)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  async lookupPlatePost(
    @Req() req: AuthenticatedRequest,
    @Body() dto: LookupPlateDto,
  ) {
    return await this.garageService.lookupVehicleByPlate(
      req.user.userId,
      dto.plate,
    );
  }

  @Get(["motorcycles/:id/diagnostic", "motorcycles/:id/verifik-diagnostic"])
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  async getMotorcycleDiagnostic(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseObjectIdPipe) id: string,
  ) {
    return await this.garageService.getMotorcycleDiagnostic(
      req.user.userId,
      id,
    );
  }

  @Post(["motorcycles/:id/sync", "motorcycles/:id/verifik-sync"])
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  async syncMotorcycleWithVerifik(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseObjectIdPipe) id: string,
    @Body() dto?: VerifyRuntDto,
  ) {
    return await this.garageService.syncMotorcycleWithVerifik(
      req.user.userId,
      id,
      dto,
    );
  }

  @Post("sync-from-profile")
  @HttpCode(HttpStatus.OK)
  async syncFromProfile(@Req() req: AuthenticatedRequest) {
    return await this.garageService.syncMotorcycleFromProfile(req.user.userId);
  }

  @Public()
  @Post("allied/service-order")
  @UseGuards(AlliedWorkshopGuard)
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async recordAlliedServiceOrder(@Body() dto: AlliedServiceOrderDto) {
    return this.garageService.recordAlliedServiceOrder(dto);
  }

  @Public()
  @Get(["allied/workshops", "allied-workshops"])
  async getAlliedWorkshops() {
    return await this.garageService.getAlliedWorkshops();
  }
}
